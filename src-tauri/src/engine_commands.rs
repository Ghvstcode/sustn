use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use std::sync::Arc;

use crate::engine::{self, budget, db, scanner, scheduler, worker, CurrentTask, EngineState, TaskPhase};

/// Get the current budget status.
#[tauri::command]
pub async fn engine_get_budget(app: AppHandle) -> Result<budget::BudgetStatus, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let config = db::read_budget_config(&app_data_dir);
    Ok(budget::calculate_budget_status(&config))
}

/// Trigger an immediate scan of a repository.
/// Pass 1 (quick scan) runs synchronously and returns results.
/// Pass 2 (deep scan) spawns in the background if budget allows,
/// persists tasks directly to DB, and emits an event when done.
#[tauri::command]
pub async fn engine_scan_now(
    app: AppHandle,
    repo_path: String,
    repository_id: String,
) -> Result<scanner::ScanResult, String> {
    println!("[engine] engine_scan_now invoked — repo_path={repo_path}, repository_id={repository_id}");

    // Emit scan-started event
    let _ = app.emit("agent:scan-started", serde_json::json!({
        "repositoryId": repository_id,
    }));

    // Read project-specific scan preferences
    let app_data_dir_for_prefs = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let (_agent_prefs, scan_prefs) = db::read_project_preferences(&app_data_dir_for_prefs, &repository_id);

    // --- Pass 1: Quick scan (pre-read files, no tool use) ---
    let result = scanner::scan_repository(&repo_path, scan_prefs.as_deref()).await;

    // Emit pass 1 completed event
    let _ = app.emit("agent:scan-completed", serde_json::json!({
        "repositoryId": repository_id,
        "tasksFound": result.tasks_found.len(),
        "success": result.success,
        "error": result.error,
    }));

    // --- Pass 2: Deep scan (background, if budget allows) ---
    if result.success && !result.tasks_found.is_empty() {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        let config = db::read_budget_config(&app_data_dir);
        let status = budget::calculate_budget_status(&config);

        if !status.budget_exhausted {
            let pass1_titles: Vec<String> = result
                .tasks_found
                .iter()
                .map(|t| t.title.clone())
                .collect();
            let app_clone = app.clone();
            let repo_path_clone = repo_path.clone();
            let repo_id_clone = repository_id.clone();
            let scan_prefs_clone = scan_prefs.clone();

            // Access shared engine state to coordinate with task execution
            let engine_state: tauri::State<'_, Arc<EngineState>> = app.state();
            let engine_state_clone = Arc::clone(&engine_state);

            tokio::spawn(async move {
                println!("[engine] deep scan starting for repository {repo_id_clone}");

                // Mark this repo as deep-scanning so engine_start_task can wait
                engine_state_clone.deep_scanning_repos.lock().await.insert(repo_id_clone.clone());

                let _ = app_clone.emit("agent:scan-deep-started", serde_json::json!({
                    "repositoryId": repo_id_clone,
                }));

                let deep_result = scanner::deep_scan_repository(
                    &repo_path_clone,
                    &pass1_titles,
                    scan_prefs_clone.as_deref(),
                )
                .await;

                if deep_result.success && !deep_result.tasks_found.is_empty() {
                    // Persist tasks directly to DB
                    let app_data_dir = match app_clone.path().app_data_dir() {
                        Ok(dir) => dir,
                        Err(e) => {
                            println!("[engine] deep scan — failed to get app data dir: {e}");
                            let _ = app_clone.emit("agent:scan-deep-failed", serde_json::json!({
                                "repositoryId": repo_id_clone,
                                "error": format!("Failed to get app data dir: {e}"),
                            }));
                            engine_state_clone.deep_scanning_repos.lock().await.remove(&repo_id_clone);
                            return;
                        }
                    };

                    match db::save_scanned_tasks(
                        &app_data_dir,
                        &repo_id_clone,
                        &deep_result.tasks_found,
                    ) {
                        Ok(task_ids) => {
                            println!(
                                "[engine] deep scan completed — {} new tasks persisted",
                                task_ids.len()
                            );
                            let _ = app_clone.emit("agent:scan-deep-completed", serde_json::json!({
                                "repositoryId": repo_id_clone,
                                "tasksFound": task_ids.len(),
                                "taskIds": task_ids,
                            }));
                        }
                        Err(e) => {
                            println!("[engine] deep scan — failed to save tasks: {e}");
                            let _ = app_clone.emit("agent:scan-deep-failed", serde_json::json!({
                                "repositoryId": repo_id_clone,
                                "error": e,
                            }));
                        }
                    }
                } else {
                    println!(
                        "[engine] deep scan completed — no additional tasks found (success={}, error={:?})",
                        deep_result.success, deep_result.error
                    );
                    let _ = app_clone.emit("agent:scan-deep-completed", serde_json::json!({
                        "repositoryId": repo_id_clone,
                        "tasksFound": 0,
                        "taskIds": serde_json::Value::Array(vec![]),
                    }));
                }

                // Clear deep-scanning flag so waiting tasks can proceed
                engine_state_clone.deep_scanning_repos.lock().await.remove(&repo_id_clone);
                println!("[engine] deep scan flag cleared for repository {repo_id_clone}");
            });
        } else {
            println!("[engine] deep scan skipped — budget exhausted");
        }
    }

    Ok(result)
}

/// Start working on a specific task.
#[tauri::command]
pub async fn engine_start_task(
    app: AppHandle,
    state: State<'_, Arc<EngineState>>,
    task_id: String,
    repository_id: String,
    repo_path: String,
    task_title: String,
    task_description: String,
    files_involved: Vec<String>,
    base_branch: String,
    branch_name: String,
    user_messages: Option<String>,
    resume_session_id: Option<String>,
) -> Result<worker::WorkResult, String> {
    println!("[engine_start_task] invoked — task_id={task_id}, repo_path={repo_path}, title={task_title}, base_branch={base_branch}, branch_name={branch_name}, has_user_messages={}, resume_session={:?}", user_messages.is_some(), resume_session_id);

    // Wait for any active deep scan on this repo to finish.
    // Running two Claude CLI instances in the same repo concurrently causes
    // git conflicts and unpredictable behavior.
    {
        let mut waited = false;
        loop {
            let is_scanning = state.deep_scanning_repos.lock().await.contains(&repository_id);
            if !is_scanning {
                break;
            }
            if !waited {
                println!("[engine_start_task] waiting for deep scan to finish on {repository_id}...");
                let _ = app.emit("agent:task-waiting-for-scan", serde_json::json!({
                    "taskId": task_id,
                    "repositoryId": repository_id,
                }));
                waited = true;
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        if waited {
            println!("[engine_start_task] deep scan finished, proceeding with task {task_id}");
        }
    }

    // Check budget before starting work (respects per-project ceiling override)
    {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        let mut config = db::read_budget_config(&app_data_dir);
        // Apply per-project ceiling override (may be lower than global)
        let effective_ceiling = db::read_effective_ceiling_percent(&app_data_dir, &repository_id);
        if effective_ceiling < config.max_usage_percent {
            config.max_usage_percent = effective_ceiling;
        }
        let status = budget::calculate_budget_status(&config);
        if status.budget_exhausted {
            println!("[engine_start_task] BLOCKED — budget exhausted (available={}, ceiling={}%)", status.tokens_available_for_sustn, effective_ceiling);
            return Err("Budget exhausted — cannot start task".to_string());
        }
    }

    // Check if a task is already running
    {
        let current = state.current_task.lock().await;
        if current.is_some() {
            println!("[engine_start_task] BLOCKED — another task already in progress");
            return Err("Another task is already in progress".to_string());
        }
    }

    // Set current task
    {
        let mut current = state.current_task.lock().await;
        *current = Some(CurrentTask {
            task_id: task_id.clone(),
            repository_id: repository_id.clone(),
            phase: TaskPhase::Implementing,
            started_at: chrono::Local::now().to_rfc3339(),
        });
    }
    println!("[engine_start_task] current_task set — emitting agent:task-started");

    // Emit task-started event
    let _ = app.emit("agent:task-started", serde_json::json!({
        "taskId": task_id,
        "repositoryId": repository_id,
    }));

    // Read project-specific agent preferences
    let (agent_prefs, _scan_prefs) = {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        db::read_project_preferences(&app_data_dir, &repository_id)
    };

    // Execute the task
    println!("[engine_start_task] calling worker::execute_task — max_retries=2");
    let result = worker::execute_task(
        &repo_path,
        &task_id,
        &task_title,
        &task_description,
        &files_involved,
        2, // max retries
        &base_branch,
        &branch_name,
        user_messages,
        resume_session_id,
        agent_prefs.as_deref(),
    )
    .await;

    println!(
        "[engine_start_task] worker finished — success={}, phase={:?}, branch={:?}, sha={:?}, error={:?}",
        result.success, result.phase_reached, result.branch_name, result.commit_sha, result.error
    );

    // Clear current task
    {
        let mut current = state.current_task.lock().await;
        *current = None;
    }

    // Emit completion event
    if result.success {
        println!("[engine_start_task] emitting agent:task-completed — branch={:?}", result.branch_name);
        let _ = app.emit("agent:task-completed", serde_json::json!({
            "taskId": task_id,
            "repositoryId": repository_id,
            "branchName": result.branch_name,
            "commitSha": result.commit_sha,
        }));
    } else {
        println!("[engine_start_task] emitting agent:task-failed — error={:?}", result.error);
        let _ = app.emit("agent:task-failed", serde_json::json!({
            "taskId": task_id,
            "repositoryId": repository_id,
            "error": result.error,
        }));
    }

    Ok(result)
}

/// Get the current engine status.
#[tauri::command]
pub async fn engine_get_status(
    state: State<'_, Arc<EngineState>>,
) -> Result<EngineStatusResponse, String> {
    let running = *state.running.read().await;
    let current_task = state.current_task.lock().await.clone();

    Ok(EngineStatusResponse {
        running,
        current_task,
    })
}

/// Check if work is allowed for a project given its schedule config.
#[tauri::command]
pub fn engine_check_schedule(
    enabled: bool,
    schedule_mode: String,
    window_start: Option<String>,
    window_end: Option<String>,
) -> scheduler::CanWorkResult {
    let mode = match schedule_mode.as_str() {
        "always" => scheduler::ScheduleMode::Always,
        "scheduled" => scheduler::ScheduleMode::Scheduled,
        "manual" => scheduler::ScheduleMode::Manual,
        _ => scheduler::ScheduleMode::Always,
    };

    let config = scheduler::ScheduleConfig {
        enabled,
        schedule_mode: mode,
        window_start,
        window_end,
        scan_interval_minutes: 360,
    };

    scheduler::can_work_now(&config)
}

/// Push a task's branch to remote and optionally create a PR.
#[tauri::command]
pub async fn engine_push_branch(
    repo_path: String,
    branch_name: String,
) -> Result<engine::git::GitResult, String> {
    Ok(engine::git::push_branch(&repo_path, &branch_name))
}

/// List all local branches for a repository.
#[tauri::command]
pub async fn engine_list_branches(
    repo_path: String,
) -> Result<Vec<engine::git::BranchInfo>, String> {
    Ok(engine::git::list_branches(&repo_path))
}

/// Get unified diff between two branches.
#[tauri::command]
pub async fn engine_get_diff(
    repo_path: String,
    base_branch: String,
    head_branch: String,
) -> Result<String, String> {
    let result = engine::git::diff_branches(&repo_path, &base_branch, &head_branch);
    if result.success {
        Ok(result.output)
    } else {
        Err(result.error.unwrap_or_else(|| "Failed to get diff".to_string()))
    }
}

/// Get diff file statistics between two branches.
#[tauri::command]
pub async fn engine_get_diff_stat(
    repo_path: String,
    base_branch: String,
    head_branch: String,
) -> Result<Vec<engine::git::DiffFileStat>, String> {
    engine::git::diff_stat(&repo_path, &base_branch, &head_branch)
}

/// Create a pull request using the `gh` CLI.
#[tauri::command]
pub async fn engine_create_pr(
    repo_path: String,
    branch_name: String,
    base_branch: String,
    title: String,
    body: String,
) -> Result<PrResult, String> {
    println!(
        "[engine_create_pr] creating PR — branch={branch_name}, base={base_branch}, title={title}"
    );

    let output = std::process::Command::new("gh")
        .args([
            "pr",
            "create",
            "--base",
            &base_branch,
            "--head",
            &branch_name,
            "--title",
            &title,
            "--body",
            &body,
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to execute gh: {e}"))?;

    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        println!("[engine_create_pr] PR created — url={url}");
        Ok(PrResult { url })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        println!("[engine_create_pr] gh pr create failed — {stderr}");
        Err(format!("gh pr create failed: {stderr}"))
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrResult {
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatusResponse {
    pub running: bool,
    pub current_task: Option<CurrentTask>,
}
