pub mod budget;
pub mod db;
pub mod git;
pub mod prioritizer;
pub mod scanner;
pub mod scheduler;
pub mod worker;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    /// Repository IDs that currently have a deep scan in progress.
    /// Task execution waits for the scan to finish before starting,
    /// preventing concurrent Claude CLI instances in the same repo.
    pub deep_scanning_repos: Mutex<HashSet<String>>,
}

impl EngineState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            running: RwLock::new(false),
            current_task: Mutex::new(None),
            cancel_token: Mutex::new(None),
            deep_scanning_repos: Mutex::new(HashSet::new()),
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
    /// Session ID from Claude CLI, used to resume conversations.
    pub session_id: Option<String>,
}

/// Extract session_id from Claude CLI JSON output.
fn extract_session_id(stdout: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(stdout.trim())
        .ok()
        .and_then(|v| v.get("session_id")?.as_str().map(|s| s.to_string()))
}

/// Invoke Claude Code CLI with the given prompt in the given working directory.
/// This is the core primitive that both scanner and worker use.
///
/// If `stdin_content` is provided, it is piped to the process via stdin
/// (used to pass pre-read file context, matching nightshift's approach).
///
/// If `resume_session_id` is provided, uses `--resume` to continue a
/// previous conversation instead of starting fresh.
pub async fn invoke_claude_cli(
    cwd: &str,
    prompt: &str,
    timeout_secs: u64,
    stdin_content: Option<&str>,
    max_turns: Option<u32>,
    resume_session_id: Option<&str>,
) -> Result<CliResult, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;
    use tokio::process::Command;

    println!(
        "[engine] invoke_claude_cli — cwd={cwd}, timeout={timeout_secs}s, prompt_len={}, stdin_len={}, max_turns={:?}",
        prompt.len(),
        stdin_content.map_or(0, |s| s.len()),
        max_turns,
    );
    println!("[engine] ┌─── PROMPT ───────────────────────────────────────");
    for line in prompt.lines() {
        println!("[engine] │ {line}");
    }
    println!("[engine] └─────────────────────────────────────────────────");

    let has_stdin = stdin_content.is_some();

    let mut cmd = Command::new("claude");
    cmd.args([
        "--print",
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
    ]);
    if let Some(session_id) = resume_session_id {
        cmd.args(["--resume", session_id]);
    }
    cmd.args(["-p", prompt]);
    if let Some(turns) = max_turns {
        cmd.args(["--max-turns", &turns.to_string()]);
    }
    cmd.current_dir(cwd);

    if has_stdin {
        cmd.stdin(Stdio::piped());
    }

    // When we have stdin, we need spawn() to write to it; otherwise .output() is simpler
    if let Some(content) = stdin_content {
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                println!("[engine] claude CLI failed to spawn: {e}");
                format!("Failed to execute claude CLI: {}", e)
            })?;

        // Write stdin content and close the pipe
        if let Some(mut stdin_pipe) = child.stdin.take() {
            let content = content.to_string();
            tokio::spawn(async move {
                let _ = stdin_pipe.write_all(content.as_bytes()).await;
                let _ = stdin_pipe.shutdown().await;
            });
        }

        // Take stdout/stderr before wait() so child isn't consumed
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();

        let stdout_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(mut pipe) = stdout_pipe {
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut pipe, &mut buf).await;
            }
            buf
        });

        let stderr_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(mut pipe) = stderr_pipe {
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut pipe, &mut buf).await;
            }
            buf
        });

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            child.wait(),
        )
        .await;

        match result {
            Ok(Ok(status)) => {
                let stdout_bytes = stdout_task.await.unwrap_or_default();
                let stderr_bytes = stderr_task.await.unwrap_or_default();
                let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
                let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
                let session_id = extract_session_id(&stdout);
                println!(
                    "[engine] claude CLI finished — exit_code={:?}, stdout_len={}, stderr_len={}, session_id={:?}",
                    status.code(),
                    stdout.len(),
                    stderr.len(),
                    session_id,
                );
                println!("[engine] ┌─── STDOUT ──────────────────────────────────────");
                for line in stdout.lines() {
                    println!("[engine] │ {line}");
                }
                println!("[engine] └─────────────────────────────────────────────────");
                if !stderr.is_empty() {
                    println!("[engine] ┌─── STDERR ──────────────────────────────────────");
                    for line in stderr.lines() {
                        println!("[engine] │ {line}");
                    }
                    println!("[engine] └─────────────────────────────────────────────────");
                }
                Ok(CliResult {
                    success: status.success(),
                    stdout,
                    stderr,
                    exit_code: status.code(),
                    session_id,
                })
            }
            Ok(Err(e)) => {
                println!("[engine] claude CLI failed: {e}");
                Err(format!("Failed to execute claude CLI: {}", e))
            }
            Err(_) => {
                let _ = child.kill().await;
                println!("[engine] claude CLI timed out after {timeout_secs}s");
                Err(format!(
                    "Claude CLI timed out after {} seconds",
                    timeout_secs
                ))
            }
        }
    } else {
        // No stdin — simple .output() path
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            cmd.output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let session_id = extract_session_id(&stdout);
                println!(
                    "[engine] claude CLI finished — exit_code={:?}, stdout_len={}, stderr_len={}, session_id={:?}",
                    output.status.code(),
                    stdout.len(),
                    stderr.len(),
                    session_id,
                );
                println!("[engine] ┌─── STDOUT ──────────────────────────────────────");
                for line in stdout.lines() {
                    println!("[engine] │ {line}");
                }
                println!("[engine] └─────────────────────────────────────────────────");
                if !stderr.is_empty() {
                    println!("[engine] ┌─── STDERR ──────────────────────────────────────");
                    for line in stderr.lines() {
                        println!("[engine] │ {line}");
                    }
                    println!("[engine] └─────────────────────────────────────────────────");
                }
                Ok(CliResult {
                    success: output.status.success(),
                    stdout,
                    stderr,
                    exit_code: output.status.code(),
                    session_id,
                })
            }
            Ok(Err(e)) => {
                println!("[engine] claude CLI failed to execute: {e}");
                Err(format!("Failed to execute claude CLI: {}", e))
            }
            Err(_) => {
                println!("[engine] claude CLI timed out after {timeout_secs}s");
                Err(format!(
                    "Claude CLI timed out after {} seconds",
                    timeout_secs
                ))
            }
        }
    }
}
