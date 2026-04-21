pub mod budget;
pub mod db;
pub mod git;
pub mod prioritizer;
pub mod scanner;
pub mod scheduler;
pub mod worker;
pub mod worktree;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::Emitter;
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

/// Event emitted for each line of Claude CLI output during streaming.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOutputEvent {
    pub task_id: String,
    /// Parsed "type" from stream-json: "system", "assistant", "user", "result"
    pub event_type: Option<String>,
    /// Structured content blocks extracted from the event
    pub blocks: Vec<ContentBlock>,
    /// Full JSON line (for debugging)
    pub raw: String,
    pub timestamp: String,
}

/// A parsed content block from a stream-json event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentBlock {
    /// "text", "tool_use", "tool_result", "thinking"
    pub kind: String,
    /// Text content, tool summary, or result summary
    pub text: Option<String>,
    /// Tool name (for tool_use and tool_result)
    pub tool_name: Option<String>,
    /// File path or key input hint (for tool_use)
    pub tool_target: Option<String>,
}

/// Extract human-readable content blocks from a stream-json event.
/// Returns multiple blocks because a single assistant event can contain
/// both text and tool_use blocks.
fn extract_blocks(event_type: &str, value: &serde_json::Value) -> Vec<ContentBlock> {
    match event_type {
        "assistant" | "user" => {
            // Both assistant and user events have message.content[] arrays.
            // Assistant events contain text and tool_use blocks.
            // User events contain tool_result blocks.
            value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| extract_block(item))
                        .collect()
                })
                .unwrap_or_default()
        }
        "result" => {
            let text = value
                .get("result")
                .and_then(|r| r.as_str())
                .map(|s| s.chars().take(500).collect::<String>());
            vec![ContentBlock {
                kind: "result".to_string(),
                text,
                tool_name: None,
                tool_target: None,
            }]
        }
        _ => vec![],
    }
}

fn extract_block(item: &serde_json::Value) -> Option<ContentBlock> {
    let kind = item.get("type")?.as_str()?;
    match kind {
        "text" => Some(ContentBlock {
            kind: "text".to_string(),
            text: item.get("text").and_then(|t| t.as_str()).map(String::from),
            tool_name: None,
            tool_target: None,
        }),
        "tool_use" => {
            let name = item.get("name").and_then(|n| n.as_str()).map(String::from);
            let target = item.get("input").and_then(|i| {
                i.get("file_path")
                    .or_else(|| i.get("path"))
                    .or_else(|| i.get("pattern"))
                    .or_else(|| i.get("command"))
                    .or_else(|| i.get("url"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.chars().take(200).collect::<String>())
            });
            Some(ContentBlock {
                kind: "tool_use".to_string(),
                text: None,
                tool_name: name,
                tool_target: target,
            })
        }
        "tool_result" => {
            let content_text = item.get("content").and_then(|c| {
                // tool_result content can be a string or an array of {type, text}
                if let Some(s) = c.as_str() {
                    Some(s.chars().take(300).collect::<String>())
                } else if let Some(arr) = c.as_array() {
                    arr.iter()
                        .filter_map(|b| b.get("text")?.as_str())
                        .next()
                        .map(|s| s.chars().take(300).collect::<String>())
                } else {
                    None
                }
            });
            Some(ContentBlock {
                kind: "tool_result".to_string(),
                text: content_text,
                tool_name: None,
                tool_target: None,
            })
        }
        "thinking" => Some(ContentBlock {
            kind: "thinking".to_string(),
            text: item
                .get("thinking")
                .and_then(|t| t.as_str())
                .map(|s| s.chars().take(300).collect::<String>()),
            tool_name: None,
            tool_target: None,
        }),
        _ => None,
    }
}

/// Resolve the full path to the `claude` CLI binary.
///
/// When running inside a macOS .app bundle, the process does not inherit the
/// user's shell PATH, so a bare `Command::new("claude")` fails with ENOENT.
/// We check well-known install locations and fall back to PATH as a last resort.
fn resolve_claude_binary() -> String {
    use std::path::PathBuf;

    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());

    let candidates: Vec<PathBuf> = vec![
        // Homebrew Apple Silicon
        PathBuf::from("/opt/homebrew/bin/claude"),
        // Homebrew Intel
        PathBuf::from("/usr/local/bin/claude"),
        // Claude Code's own install location
        PathBuf::from(format!("{}/.claude/bin/claude", home)),
        // npm global
        PathBuf::from(format!("{}/.npm-global/bin/claude", home)),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            let path = candidate.to_string_lossy().to_string();
            println!("[engine] resolved claude binary: {path}");
            return path;
        }
    }

    // Fall back to bare name (works when launched from a terminal with correct PATH)
    println!("[engine] claude binary not found at known paths, falling back to bare 'claude'");
    "claude".to_string()
}

/// Invoke Claude Code CLI with the given prompt in the given working directory.
///
/// Uses `--output-format stream-json --verbose` to stream newline-delimited
/// JSON events in real time. If `app_handle` and `task_id` are provided,
/// each event is emitted as an `agent:task-output` Tauri event for the
/// frontend to display live.
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
    app_handle: Option<tauri::AppHandle>,
    task_id: Option<&str>,
) -> Result<CliResult, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    println!(
        "[engine] invoke_claude_cli — cwd={cwd}, timeout={timeout_secs}s, prompt_len={}, stdin_len={}, max_turns={:?}, streaming={}",
        prompt.len(),
        stdin_content.map_or(0, |s| s.len()),
        max_turns,
        app_handle.is_some(),
    );

    let claude_bin = resolve_claude_binary();
    let mut cmd = Command::new(&claude_bin);
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
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
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if stdin_content.is_some() {
        cmd.stdin(Stdio::piped());
    }

    let mut child = cmd.spawn().map_err(|e| {
        println!("[engine] claude CLI failed to spawn: {e}");
        format!("Failed to execute claude CLI: {}", e)
    })?;

    // Write stdin content if provided
    if let Some(content) = stdin_content {
        if let Some(mut stdin_pipe) = child.stdin.take() {
            let content = content.to_string();
            tokio::spawn(async move {
                let _ = stdin_pipe.write_all(content.as_bytes()).await;
                let _ = stdin_pipe.shutdown().await;
            });
        }
    }

    // Read stdout line-by-line (stream-json emits one JSON object per line)
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let app_for_stdout = app_handle.clone();
    let task_id_for_stdout = task_id.map(|s| s.to_string());

    let stdout_task = tokio::spawn(async move {
        let mut lines = Vec::new();
        let mut session_id: Option<String> = None;
        let mut result_text: Option<String> = None;

        if let Some(pipe) = stdout_pipe {
            let reader = BufReader::new(pipe);
            let mut line_stream = reader.lines();

            while let Ok(Some(line)) = line_stream.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                // Try to parse as JSON to extract event type and content
                let parsed = serde_json::from_str::<serde_json::Value>(&line);
                let event_type = parsed
                    .as_ref()
                    .ok()
                    .and_then(|v| v.get("type")?.as_str().map(|s| s.to_string()));
                let blocks = parsed
                    .as_ref()
                    .ok()
                    .map(|v| {
                        let et = event_type.as_deref().unwrap_or("");
                        extract_blocks(et, v)
                    })
                    .unwrap_or_default();

                // Extract session_id and result from the final "result" event
                if event_type.as_deref() == Some("result") {
                    if let Ok(ref v) = parsed {
                        session_id =
                            v.get("session_id").and_then(|s| s.as_str().map(|s| s.to_string()));
                        result_text =
                            v.get("result").and_then(|r| r.as_str().map(|s| s.to_string()));
                    }
                }

                // Skip events with no meaningful content (except system init and result)
                let should_emit = !blocks.is_empty()
                    || event_type.as_deref() == Some("system")
                    || event_type.as_deref() == Some("result");

                if should_emit {
                    if let (Some(ref app), Some(ref tid)) =
                        (&app_for_stdout, &task_id_for_stdout)
                    {
                        let event = TaskOutputEvent {
                            task_id: tid.clone(),
                            event_type: event_type.clone(),
                            blocks,
                            raw: line.clone(),
                            timestamp: chrono::Local::now().to_rfc3339(),
                        };
                        let _ = app.emit("agent:task-output", &event);
                    }
                }

                lines.push(line);
            }
        }

        (lines, session_id, result_text)
    });

    let stderr_task = tokio::spawn(async move {
        let mut stderr_lines = Vec::new();
        if let Some(pipe) = stderr_pipe {
            let reader = BufReader::new(pipe);
            let mut line_stream = reader.lines();
            while let Ok(Some(line)) = line_stream.next_line().await {
                stderr_lines.push(line);
            }
        }
        stderr_lines
    });

    // Wait for the process with timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait(),
    )
    .await;

    match result {
        Ok(Ok(status)) => {
            let (stdout_lines, cli_session_id, result_text) =
                stdout_task.await.unwrap_or_else(|_| (vec![], None, None));
            let stderr_lines = stderr_task.await.unwrap_or_default();
            let stderr = stderr_lines.join("\n");

            // Synthesize stdout as if it came from --output-format json
            // so that parse_implement_output / parse_review_output still work.
            let stdout = if let Some(ref result) = result_text {
                // Build a JSON envelope matching the old format
                let envelope = serde_json::json!({
                    "type": "result",
                    "subtype": "success",
                    "result": result,
                    "session_id": cli_session_id,
                });
                envelope.to_string()
            } else {
                // Fallback: join all lines (shouldn't normally happen)
                stdout_lines.join("\n")
            };

            println!(
                "[engine] claude CLI finished — exit_code={:?}, stdout_len={}, stderr_len={}, session_id={:?}",
                status.code(),
                stdout.len(),
                stderr.len(),
                cli_session_id,
            );

            Ok(CliResult {
                success: status.success(),
                stdout,
                stderr,
                exit_code: status.code(),
                session_id: cli_session_id,
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
}
