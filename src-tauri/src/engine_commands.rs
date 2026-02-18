use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use std::sync::Arc;

use crate::engine::{self, budget, scanner, scheduler, worker, CurrentTask, EngineState, TaskPhase};

/// Get the current budget status.
#[tauri::command]
pub async fn engine_get_budget() -> Result<budget::BudgetStatus, String> {
    let config = budget::BudgetConfig::default(); // TODO: read from DB
    Ok(budget::calculate_budget_status(&config))
}

/// Trigger an immediate scan of a repository.
#[tauri::command]
pub async fn engine_scan_now(
    app: AppHandle,
    repo_path: String,
    repository_id: String,
) -> Result<scanner::ScanResult, String> {
    // Emit scan-started event
    let _ = app.emit("agent:scan-started", serde_json::json!({
        "repositoryId": repository_id,
    }));

    let result = scanner::scan_repository(&repo_path).await;

    // Emit scan-completed event
    let _ = app.emit("agent:scan-completed", serde_json::json!({
        "repositoryId": repository_id,
        "tasksFound": result.tasks_found.len(),
        "success": result.success,
        "error": result.error,
    }));

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
    // Check if a task is already running
    {
        let current = state.current_task.lock().await;
        if current.is_some() {
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

    // Emit task-started event
    let _ = app.emit("agent:task-started", serde_json::json!({
        "taskId": task_id,
        "repositoryId": repository_id,
    }));

    // Execute the task
    let result = worker::execute_task(
        &repo_path,
        &task_id,
        &task_title,
        &task_description,
        &files_involved,
        2, // max retries
    )
    .await;

    // Clear current task
    {
        let mut current = state.current_task.lock().await;
        *current = None;
    }

    // Emit completion event
    if result.success {
        let _ = app.emit("agent:task-completed", serde_json::json!({
            "taskId": task_id,
            "repositoryId": repository_id,
            "branchName": result.branch_name,
            "commitSha": result.commit_sha,
        }));
    } else {
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatusResponse {
    pub running: bool,
    pub current_task: Option<CurrentTask>,
}
