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

    // Pre-flight: verify git works in this repo before doing anything
    if let Some(issue) = engine::git::preflight_check(&repo_path) {
        println!("[engine_start_task] BLOCKED — environment issue: {}", issue.error);
        let _ = app.emit("agent:environment-issue", serde_json::json!({
            "error": issue.error,
            "fixCommand": issue.fix_command,
            "fixLabel": issue.fix_label,
        }));
        return Err(format!("Environment issue: {}", issue.error));
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

    // Create worktree for task isolation
    let _ = engine::worktree::ensure_gitignore_entry(&repo_path);
    let worktree_path = engine::worktree::create_worktree(
        &repo_path,
        &task_id,
        &branch_name,
        &base_branch,
    )
    .map_err(|e| {
        // Clear current_task on worktree creation failure
        let state_clone = state.inner().clone();
        tokio::spawn(async move {
            *state_clone.current_task.lock().await = None;
        });
        e
    })?;
    println!("[engine_start_task] worktree created at {worktree_path}");

    // Execute the task in the worktree
    println!("[engine_start_task] calling worker::execute_task — max_retries=4");
    let result = worker::execute_task(
        &worktree_path,
        &task_id,
        &task_title,
        &task_description,
        &files_involved,
        4, // max retries
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
        println!("[engine_start_task] emitting agent:task-completed — branch={:?}, has_warnings={}", result.branch_name, result.review_warnings.is_some());
        let _ = app.emit("agent:task-completed", serde_json::json!({
            "taskId": task_id,
            "repositoryId": repository_id,
            "branchName": result.branch_name,
            "commitSha": result.commit_sha,
            "reviewWarnings": result.review_warnings,
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

/// Open Terminal.app and run a command (for environment fixes that need user interaction).
#[tauri::command]
pub async fn run_terminal_command(command: String) -> Result<(), String> {
    // Use osascript to open Terminal and run the command.
    // This handles sudo prompts, license agreements, etc. interactively.
    let script = format!(
        r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );

    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("Failed to open Terminal: {e}"))?;

    Ok(())
}

/// Augment imported tasks with codebase context using Claude CLI.
/// Accepts a batch of tasks and returns enriched metadata for each.
#[tauri::command]
pub async fn engine_augment_tasks(
    repo_path: String,
    tasks: Vec<AugmentTaskInput>,
) -> Result<Vec<AugmentTaskResult>, String> {
    println!(
        "[engine_augment_tasks] augmenting {} tasks for repo={}",
        tasks.len(),
        repo_path
    );

    // Collect source files for context
    let context = scanner::collect_source_files(&repo_path)?;

    // Build prompt with all tasks
    let mut task_list = String::new();
    for (i, t) in tasks.iter().enumerate() {
        task_list.push_str(&format!(
            "Task {}: {}\nDescription: {}\n\n",
            i + 1,
            t.title,
            t.description.as_deref().unwrap_or("(no description)")
        ));
    }

    let prompt = format!(
        r#"You are analyzing tasks imported from an issue tracker in the context of a codebase.
For each task below, analyze the codebase and return enriched metadata.

{}

Output ONLY a JSON array (one entry per task, same order) with no markdown formatting:
[{{
  "files_involved": ["path/to/file.ts"],
  "estimated_effort": "low" | "medium" | "high",
  "enriched_description": "Enhanced description with codebase context...",
  "category": "feature" | "tech_debt" | "tests" | "docs" | "security" | "performance" | "dx" | "observability" | "general"
}}]"#,
        task_list
    );

    let result = engine::invoke_claude_cli(
        &repo_path,
        &prompt,
        300, // 5 min timeout
        Some(&context),
        None,
        None,
    )
    .await?;

    if !result.success {
        return Err(format!(
            "Claude CLI failed: {}",
            result.stderr
        ));
    }

    // Parse the JSON array from stdout
    let json_str = scanner::extract_json_array_raw(&result.stdout)
        .ok_or_else(|| "Failed to extract JSON array from augmentation response".to_string())?;

    let results: Vec<AugmentTaskResult> = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse augmentation results: {e}"))?;

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AugmentTaskInput {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AugmentTaskResult {
    pub files_involved: Vec<String>,
    pub estimated_effort: String,
    pub enriched_description: String,
    pub category: String,
}

/// Run a `gh api` GET request and return the raw JSON output.
#[tauri::command]
pub async fn run_gh_api(
    repo_path: String,
    endpoint: String,
    accept: Option<String>,
) -> Result<GhApiResult, String> {
    let gh = crate::preflight::resolve_gh_binary_pub();

    let mut cmd = std::process::Command::new(&gh);
    cmd.args(["api", &endpoint]);
    if let Some(accept_header) = accept {
        cmd.args(["-H", &format!("Accept: {accept_header}")]);
    }
    cmd.current_dir(&repo_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute gh: {e}"))?;

    Ok(GhApiResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// Run a `gh api` POST request with a JSON body.
#[tauri::command]
pub async fn run_gh_api_post(
    repo_path: String,
    endpoint: String,
    body: String,
) -> Result<GhApiResult, String> {
    let gh = crate::preflight::resolve_gh_binary_pub();

    let output = std::process::Command::new(&gh)
        .args(["api", &endpoint, "--method", "POST", "--input", "-"])
        .current_dir(&repo_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(ref mut stdin) = child.stdin {
                stdin.write_all(body.as_bytes())?;
            }
            child.wait_with_output()
        })
        .map_err(|e| format!("Failed to execute gh: {e}"))?;

    Ok(GhApiResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhApiResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Address PR review comments by invoking Claude CLI with the review context.
/// Resumes the original session when available so Claude has full reasoning context.
#[tauri::command]
pub async fn engine_address_review(
    app: AppHandle,
    state: State<'_, Arc<EngineState>>,
    task_id: String,
    repository_id: String,
    repo_path: String,
    branch_name: String,
    base_branch: String,
    review_comments: String,
    pr_description: String,
    resume_session_id: Option<String>,
    pr_diff: Option<String>,
) -> Result<worker::WorkResult, String> {
    println!(
        "[engine_address_review] task_id={task_id}, branch={branch_name}, comments_len={}, resume={:?}",
        review_comments.len(),
        resume_session_id,
    );

    // Wait for deep scan
    {
        loop {
            let is_scanning = state.deep_scanning_repos.lock().await.contains(&repository_id);
            if !is_scanning { break; }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    if let Some(issue) = engine::git::preflight_check(&repo_path) {
        return Err(format!("Environment issue: {}", issue.error));
    }

    // Budget check
    {
        let app_data_dir = app.path().app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        let mut config = db::read_budget_config(&app_data_dir);
        let effective_ceiling = db::read_effective_ceiling_percent(&app_data_dir, &repository_id);
        if effective_ceiling < config.max_usage_percent {
            config.max_usage_percent = effective_ceiling;
        }
        let status = budget::calculate_budget_status(&config);
        if status.budget_exhausted {
            return Err("Budget exhausted — cannot address review".to_string());
        }
    }

    {
        let current = state.current_task.lock().await;
        if current.is_some() {
            return Err("Another task is already in progress".to_string());
        }
    }

    {
        let mut current = state.current_task.lock().await;
        *current = Some(CurrentTask {
            task_id: task_id.clone(),
            repository_id: repository_id.clone(),
            phase: TaskPhase::Implementing,
            started_at: chrono::Local::now().to_rfc3339(),
        });
    }

    let _ = app.emit("agent:task-started", serde_json::json!({
        "taskId": task_id,
        "repositoryId": repository_id,
    }));

    let (agent_prefs, _) = {
        let app_data_dir = app.path().app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        db::read_project_preferences(&app_data_dir, &repository_id)
    };

    let prefs_section = match agent_prefs.as_deref() {
        Some(prefs) if !prefs.trim().is_empty() => format!("\n\n## Project-Specific Instructions\n{prefs}"),
        _ => String::new(),
    };

    // For imported PRs on the first cycle (no session), include the full diff
    // so Claude understands the PR before addressing comments.
    let pr_context_section = match (&resume_session_id, &pr_diff) {
        (None, Some(diff)) => format!(
            r#"

## Full PR Diff (you are taking over this PR — study it carefully)
```diff
{diff}
```
"#
        ),
        _ => String::new(),
    };

    let prompt = format!(
        r#"IMPORTANT: You are running as an automated background agent in non-interactive mode. Commit your changes directly — do NOT ask for permission.

A human reviewer has left comments on a PR. You need to handle EVERY comment — either by making code changes or by drafting a reply.

## PR Description
{pr_description}
{pr_context_section}
## Review Comments
Each comment below has a COMMENT_ID number that you MUST include in your response.

{review_comments}
{prefs_section}

## Instructions
For EACH review comment above:

1. **If it requires code changes** (bug fix, refactor, improvement, the reviewer is questioning an approach and they're right): make the changes, commit with trailer SUSTN-Task: {task_id}, and draft a reply explaining what you changed.

2. **If it's a question about your reasoning** (why did you do X?): explain your reasoning clearly — you have context from when you wrote this code.

3. **If it's praise or acknowledgment** (looks good, nice, etc.): draft a brief thanks.

CRITICAL: You MUST return a reply for EVERY comment. Use the exact COMMENT_ID number from each comment header above.

After making any code changes and committing, output ONLY this JSON (no markdown):
{{
  "replies": [
    {{
      "comment_id": 1234567890,
      "reply": "Your response to this specific comment",
      "made_code_changes": true
    }}
  ],
  "summary": "Brief description of what was changed",
  "files_modified": ["list", "of", "files"]
}}

The comment_id MUST be the numeric ID from the [COMMENT_ID: <number>] tag in each comment above. Do NOT use null."#
    );

    // Create/reuse worktree for task isolation
    let _ = engine::worktree::ensure_gitignore_entry(&repo_path);
    let worktree_path = engine::worktree::create_worktree(
        &repo_path,
        &task_id,
        &branch_name,
        &base_branch,
    )
    .map_err(|e| {
        let state_clone = state.inner().clone();
        tokio::spawn(async move {
            *state_clone.current_task.lock().await = None;
        });
        e
    })?;
    println!("[engine_address_review] using worktree at {worktree_path}");

    // Call Claude CLI directly with our exact prompt (not through worker,
    // which overrides the prompt with its own resume template)
    let cli_result = engine::invoke_claude_cli(
        &worktree_path,
        &prompt,
        1800, // 30 min timeout
        None,
        None,
        resume_session_id.as_deref(),
    )
    .await;

    // Get commit SHA after Claude ran
    let sha_result = engine::git::latest_commit_sha(&worktree_path);
    let commit_sha = if sha_result.success { Some(sha_result.output) } else { None };
    let session_id = cli_result.as_ref().ok().and_then(|r| r.session_id.clone());

    // Build result
    let (success, summary, error) = match &cli_result {
        Ok(r) if r.success => {
            // Extract the result text from Claude's JSON wrapper
            let summary = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&r.stdout) {
                v.get("result")
                    .and_then(|r| r.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| r.stdout.clone())
            } else {
                r.stdout.clone()
            };
            (true, Some(summary), None)
        }
        Ok(r) => (false, None, Some(format!("Claude CLI returned error: {}", r.stderr))),
        Err(e) => (false, None, Some(e.clone())),
    };

    let result = worker::WorkResult {
        success,
        phase_reached: engine::TaskPhase::Implementing,
        branch_name: Some(branch_name.clone()),
        commit_sha: commit_sha.clone(),
        files_modified: vec![],
        summary: summary.clone(),
        review_warnings: None,
        error: error.clone(),
        session_id: session_id.clone(),
    };

    {
        let mut current = state.current_task.lock().await;
        *current = None;
    }

    if success {
        let _ = app.emit("agent:review-addressed", serde_json::json!({
            "taskId": task_id,
            "repositoryId": repository_id,
            "branchName": branch_name,
            "commitSha": commit_sha,
        }));
    } else {
        let _ = app.emit("agent:review-address-failed", serde_json::json!({
            "taskId": task_id,
            "repositoryId": repository_id,
            "error": error,
        }));
    }

    Ok(result)
}

/// Remove a task's worktree (cleanup after completion/dismissal).
#[tauri::command]
pub async fn engine_cleanup_worktree(
    repo_path: String,
    task_id: String,
) -> Result<(), String> {
    engine::worktree::remove_worktree(&repo_path, &task_id)
}

/// Clone a repository (non-blocking, no credential prompts).
#[tauri::command]
pub async fn engine_clone_repo(
    url: String,
    destination: String,
) -> Result<engine::git::GitResult, String> {
    // Run on blocking thread since clone can take a while
    tokio::task::spawn_blocking(move || {
        Ok(engine::git::clone_repo(&url, &destination))
    })
    .await
    .map_err(|e| format!("Clone task failed: {}", e))?
}

/// Fetch a specific branch from origin (with optional PR number for fork fallback).
#[tauri::command]
pub async fn engine_fetch_branch(
    repo_path: String,
    branch_name: String,
    pr_number: Option<u32>,
) -> Result<engine::git::GitResult, String> {
    Ok(engine::git::fetch_branch_with_pr(&repo_path, &branch_name, pr_number))
}

/// Get the remote URL for origin.
#[tauri::command]
pub async fn engine_get_remote_url(
    repo_path: String,
) -> Result<String, String> {
    let result = engine::git::get_remote_url(&repo_path);
    if result.success {
        Ok(result.output)
    } else {
        Err(result.error.unwrap_or_else(|| "Failed to get remote URL".to_string()))
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatusResponse {
    pub running: bool,
    pub current_task: Option<CurrentTask>,
}
