use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use std::sync::Arc;

use crate::engine::{self, budget, db, scanner, scheduler, worker, CurrentTask, EngineState, TaskPhase};

/// Get the current budget status.
#[tauri::command]
pub async fn engine_get_budget() -> Result<budget::BudgetStatus, String> {
    let config = budget::BudgetConfig::default(); // TODO: read from DB
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

    // --- Pass 1: Quick scan (pre-read files, no tool use) ---
    let result = scanner::scan_repository(&repo_path).await;

    // Emit pass 1 completed event
    let _ = app.emit("agent:scan-completed", serde_json::json!({
        "repositoryId": repository_id,
        "tasksFound": result.tasks_found.len(),
        "success": result.success,
        "error": result.error,
    }));

    // --- Pass 2: Deep scan (background, if budget allows) ---
    if result.success && !result.tasks_found.is_empty() {
        let config = budget::BudgetConfig::default();
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

            tokio::spawn(async move {
                println!("[engine] deep scan starting for repository {repo_id_clone}");

                let _ = app_clone.emit("agent:scan-deep-started", serde_json::json!({
                    "repositoryId": repo_id_clone,
                }));

                let deep_result = scanner::deep_scan_repository(
                    &repo_path_clone,
                    &pass1_titles,
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
) -> Result<worker::WorkResult, String> {
    println!("[engine_start_task] invoked — task_id={task_id}, repo_path={repo_path}, title={task_title}");

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

    // Execute the task
    println!("[engine_start_task] calling worker::execute_task — max_retries=2");
    let result = worker::execute_task(
        &repo_path,
        &task_id,
        &task_title,
        &task_description,
        &files_involved,
        2, // max retries
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

/// Pause the agent for a specific project (or globally if no repo_id).
#[tauri::command]
pub async fn engine_pause(
    _state: State<'_, Arc<EngineState>>,
    _repository_id: Option<String>,
) -> Result<(), String> {
    // TODO: Update agent_config.enabled = 0 in DB for the given repo
    // For now this is a placeholder
    Ok(())
}

/// Resume the agent for a specific project.
#[tauri::command]
pub async fn engine_resume(
    _state: State<'_, Arc<EngineState>>,
    _repository_id: Option<String>,
) -> Result<(), String> {
    // TODO: Update agent_config.enabled = 1 in DB for the given repo
    Ok(())
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
    Ok(engine::git::diff_stat(&repo_path, &base_branch, &head_branch))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatusResponse {
    pub running: bool,
    pub current_task: Option<CurrentTask>,
}
