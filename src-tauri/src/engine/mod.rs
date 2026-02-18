pub mod budget;
pub mod git;
pub mod prioritizer;
pub mod scanner;
pub mod scheduler;
pub mod worker;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// Global engine state shared across Tauri commands and the background scheduler.
pub struct EngineState {
    /// Whether the engine scheduler loop is running.
    pub running: RwLock<bool>,
    /// The currently executing task (if any). Only one task runs at a time.
    pub current_task: Mutex<Option<CurrentTask>>,
    /// Handle to cancel the scheduler loop.
    pub cancel_token: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

impl EngineState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            running: RwLock::new(false),
            current_task: Mutex::new(None),
            cancel_token: Mutex::new(None),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentTask {
    pub task_id: String,
    pub repository_id: String,
    pub phase: TaskPhase,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPhase {
    Planning,
    Implementing,
    Reviewing,
}

/// Result of invoking Claude Code CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Invoke Claude Code CLI with the given prompt in the given working directory.
/// This is the core primitive that both scanner and worker use.
pub async fn invoke_claude_cli(
    cwd: &str,
    prompt: &str,
    timeout_secs: u64,
) -> Result<CliResult, String> {
    use tokio::process::Command;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        Command::new("claude")
            .args([
                "--print",
                "--output-format",
                "json",
                "--dangerously-skip-permissions",
                "-p",
                prompt,
            ])
            .current_dir(cwd)
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Ok(CliResult {
                success: output.status.success(),
                stdout,
                stderr,
                exit_code: output.status.code(),
            })
        }
        Ok(Err(e)) => Err(format!("Failed to execute claude CLI: {}", e)),
        Err(_) => Err(format!(
            "Claude CLI timed out after {} seconds",
            timeout_secs
        )),
    }
}
