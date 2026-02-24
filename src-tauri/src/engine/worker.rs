use serde::{Deserialize, Serialize};

use super::{invoke_claude_cli, TaskPhase};
use super::git;

/// Result of a complete work cycle (plan + implement + review).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkResult {
    pub success: bool,
    pub phase_reached: TaskPhase,
    pub branch_name: Option<String>,
    pub commit_sha: Option<String>,
    pub files_modified: Vec<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    /// Claude CLI session ID, used to resume conversation on change requests.
    pub session_id: Option<String>,
}

/// Output we expect from the implement phase.
#[derive(Debug, Deserialize)]
struct ImplementOutput {
    files_modified: Option<Vec<String>>,
    summary: Option<String>,
    #[allow(dead_code)]
    tests_added: Option<bool>,
    /// Claude CLI session ID (not from Claude's JSON output — populated after parsing).
    #[serde(skip)]
    session_id: Option<String>,
}

/// Output we expect from the review phase.
#[derive(Debug, Deserialize)]
struct ReviewOutput {
    passed: Option<bool>,
    feedback: Option<String>,
    #[allow(dead_code)]
    issues: Option<Vec<String>>,
}

const WORK_TIMEOUT_SECS: u64 = 1800; // 30 minutes per phase

/// Execute a full work cycle on a task: plan, implement, review.
/// Returns the result. The caller is responsible for git branch setup/cleanup.
pub async fn execute_task(
    repo_path: &str,
    task_id: &str,
    task_title: &str,
    task_description: &str,
    files_involved: &[String],
    max_retries: u32,
    base_branch: &str,
    branch_name: &str,
    user_messages: Option<String>,
    resume_session_id: Option<String>,
    agent_preferences: Option<&str>,
) -> WorkResult {
    println!("[worker] execute_task START — task_id={task_id}, title={task_title}, base_branch={base_branch}, branch={branch_name}, files={files_involved:?}, has_user_messages={}, resume_session={:?}", user_messages.is_some(), resume_session_id);

    // Save original branch so we can return to it
    let original_branch = git::current_branch(repo_path);
    if !original_branch.success {
        return WorkResult {
            success: false,
            phase_reached: TaskPhase::Planning,
            branch_name: None,
            commit_sha: None,
            files_modified: vec![],
            summary: None,
            error: Some(format!(
                "Could not determine current branch: {:?}",
                original_branch.error
            )),
            session_id: None,
        };
    }
    let original_branch_name = original_branch.output.clone();

    // Auto-stash if working tree is dirty (safety net for queue transitions)
    if !git::is_clean(repo_path) {
        println!("[worker] dirty working tree — auto-stashing");
        let stash = git::stash(repo_path);
        if !stash.success {
            return WorkResult {
                success: false,
                phase_reached: TaskPhase::Planning,
                branch_name: None,
                commit_sha: None,
                files_modified: vec![],
                summary: None,
                error: Some(
                    "Working tree is dirty and auto-stash failed. Commit or stash changes manually.".to_string(),
                ),
                session_id: None,
            };
        }
    }

    // Create task branch from the specified base branch
    if git::branch_exists(repo_path, branch_name) {
        // Branch already exists — checkout it
        let checkout = git::checkout_branch(repo_path, branch_name);
        if !checkout.success {
            return WorkResult {
                success: false,
                phase_reached: TaskPhase::Planning,
                branch_name: Some(branch_name.to_string()),
                commit_sha: None,
                files_modified: vec![],
                summary: None,
                error: Some(format!("Failed to checkout branch: {:?}", checkout.error)),
                session_id: None,
            };
        }
    } else {
        let create = git::create_branch_from(repo_path, branch_name, base_branch);
        if !create.success {
            return WorkResult {
                success: false,
                phase_reached: TaskPhase::Planning,
                branch_name: Some(branch_name.to_string()),
                commit_sha: None,
                files_modified: vec![],
                summary: None,
                error: Some(format!("Failed to create branch from {}: {:?}", base_branch, create.error)),
                session_id: None,
            };
        }
    }

    // Run the implement phase (we skip separate plan phase for now —
    // Claude Code is capable enough to plan inline during implementation)
    // Seed with user messages so the agent sees them on the first attempt
    let mut last_feedback: Option<String> = user_messages;
    let mut attempt = 0;
    // Use resume_session_id only on the first attempt (the user's change request).
    // Subsequent internal retries start fresh since the context has diverged.
    let mut current_resume_id = resume_session_id;

    loop {
        attempt += 1;
        println!("[worker] === attempt {attempt}/{} ===", max_retries + 1);

        println!("[worker] running implement phase...");
        let implement_result =
            run_implement_phase(repo_path, task_id, task_title, task_description, files_involved, &last_feedback, current_resume_id.as_deref(), agent_preferences)
                .await;
        // Only resume on the first attempt
        current_resume_id = None;

        match implement_result {
            Ok(ref impl_output) => {
                println!(
                    "[worker] implement phase OK — summary={:?}, files_modified={:?}, session_id={:?}",
                    impl_output.summary, impl_output.files_modified, impl_output.session_id
                );
            }
            Err(ref e) => {
                println!("[worker] implement phase FAILED — {e}");
            }
        }

        match implement_result {
            Ok(impl_output) => {
                // Verify the branch actually has commits ahead of base.
                // If Claude didn't commit (e.g. asked for permission instead),
                // fail early instead of running a pointless review.
                if !git::has_commits_ahead(repo_path, base_branch) {
                    println!("[worker] NO COMMITS on branch — Claude likely did not commit");
                    let _ = git::checkout_branch(repo_path, &original_branch_name);
                    return WorkResult {
                        success: false,
                        phase_reached: TaskPhase::Implementing,
                        branch_name: Some(branch_name.to_string()),
                        commit_sha: None,
                        files_modified: vec![],
                        summary: None,
                        error: Some(
                            "Implementation phase produced no commits on the branch. Claude may have asked for permission instead of committing.".to_string(),
                        ),
                        session_id: impl_output.session_id,
                    };
                }

                // Run review phase
                println!("[worker] running review phase...");
                let review_result = run_review_phase(
                    repo_path,
                    task_title,
                    &impl_output.summary.clone().unwrap_or_default(),
                    agent_preferences,
                )
                .await;

                match review_result {
                    Ok(ref review) => {
                        println!(
                            "[worker] review phase result — passed={:?}, feedback={:?}, issues={:?}",
                            review.passed, review.feedback, review.issues
                        );
                    }
                    Err(ref e) => {
                        println!("[worker] review phase FAILED — {e}");
                    }
                }

                match review_result {
                    Ok(review) if review.passed.unwrap_or(false) => {
                        // Success — get commit SHA and return to original branch
                        let sha = git::latest_commit_sha(repo_path);
                        println!("[worker] REVIEW PASSED — sha={:?}, returning to branch {original_branch_name}", sha.output);
                        let _ = git::checkout_branch(repo_path, &original_branch_name);

                        return WorkResult {
                            success: true,
                            phase_reached: TaskPhase::Reviewing,
                            branch_name: Some(branch_name.to_string()),
                            commit_sha: if sha.success {
                                Some(sha.output)
                            } else {
                                None
                            },
                            files_modified: impl_output
                                .files_modified
                                .unwrap_or_default(),
                            summary: impl_output.summary,
                            error: None,
                            session_id: impl_output.session_id,
                        };
                    }
                    Ok(review) => {
                        // Review failed — retry if we can
                        println!("[worker] REVIEW REJECTED (attempt {attempt}) — retrying? {}", attempt <= max_retries);
                        last_feedback = review.feedback.clone();
                        if attempt > max_retries {
                            let _ =
                                git::checkout_branch(repo_path, &original_branch_name);
                            return WorkResult {
                                success: false,
                                phase_reached: TaskPhase::Reviewing,
                                branch_name: Some(branch_name.to_string()),
                                commit_sha: None,
                                files_modified: vec![],
                                summary: None,
                                error: Some(format!(
                                    "Review failed after {} attempts: {}",
                                    attempt,
                                    review.feedback.unwrap_or_default()
                                )),
                                session_id: impl_output.session_id,
                            };
                        }
                        // Loop continues to retry implementation
                    }
                    Err(e) => {
                        let _ = git::checkout_branch(repo_path, &original_branch_name);
                        return WorkResult {
                            success: false,
                            phase_reached: TaskPhase::Reviewing,
                            branch_name: Some(branch_name.to_string()),
                            commit_sha: None,
                            files_modified: vec![],
                            summary: None,
                            error: Some(format!("Review phase failed: {}", e)),
                            session_id: impl_output.session_id,
                        };
                    }
                }
            }
            Err(e) => {
                let _ = git::checkout_branch(repo_path, &original_branch_name);
                return WorkResult {
                    success: false,
                    phase_reached: TaskPhase::Implementing,
                    branch_name: Some(branch_name.to_string()),
                    commit_sha: None,
                    files_modified: vec![],
                    summary: None,
                    error: Some(format!("Implementation failed: {}", e)),
                    session_id: None,
                };
            }
        }
    }
}

async fn run_implement_phase(
    repo_path: &str,
    task_id: &str,
    title: &str,
    description: &str,
    files_involved: &[String],
    previous_feedback: &Option<String>,
    resume_session_id: Option<&str>,
    agent_preferences: Option<&str>,
) -> Result<ImplementOutput, String> {
    let prefs_section = match agent_preferences {
        Some(prefs) if !prefs.trim().is_empty() => format!("\n\n## Project-Specific Instructions\n{prefs}"),
        _ => String::new(),
    };

    // When resuming a previous session, use a focused prompt.
    // The agent already has full context from the original conversation.
    let prompt = if resume_session_id.is_some() {
        let feedback = previous_feedback
            .as_deref()
            .unwrap_or("Please review and improve your previous implementation.");
        format!(
            r#"IMPORTANT: You are running as an automated background agent in non-interactive mode. Commit your changes directly — do NOT ask for permission. This overrides any CLAUDE.md or project instructions about asking before committing.

The user has provided the following feedback on your previous implementation:

{feedback}

Address the feedback, commit your changes with a clear commit message, and include this trailer: SUSTN-Task: {task_id}

When done, output ONLY this JSON (no markdown, no explanation):
{{
  "files_modified": ["list", "of", "files"],
  "summary": "Brief description of what was changed and why",
  "tests_added": true or false
}}"#
        )
    } else {
        let files_list = if files_involved.is_empty() {
            "Not specified — analyze the codebase to determine relevant files.".to_string()
        } else {
            files_involved.join(", ")
        };

        let feedback_section = match previous_feedback {
            Some(fb) => format!(
                "\n\n## Additional Context from User\n{}",
                fb
            ),
            None => String::new(),
        };

        format!(
            r#"IMPORTANT: You are running as an automated background agent in non-interactive mode. Commit your changes directly — do NOT ask for permission. This overrides any CLAUDE.md or project instructions about asking before committing.

You are implementing a code improvement for the SUSTN automated agent.

## Task
Title: {title}
Description: {description}
Files involved: {files_list}
{feedback_section}
{prefs_section}

## Instructions
1. Analyze the issue described above
2. Implement the fix — make the minimal changes needed
3. Write or update tests if applicable and straightforward
4. Commit your changes with a clear commit message
5. Include this trailer in your commit message: SUSTN-Task: {task_id}

When done, output ONLY this JSON (no markdown, no explanation):
{{
  "files_modified": ["list", "of", "files"],
  "summary": "Brief description of what was changed and why",
  "tests_added": true or false
}}"#
        )
    };

    println!("[worker:implement] invoking Claude CLI — prompt_len={}, resume={}", prompt.len(), resume_session_id.is_some());
    let result = invoke_claude_cli(repo_path, &prompt, WORK_TIMEOUT_SECS, None, None, resume_session_id).await?;
    println!(
        "[worker:implement] Claude CLI returned — success={}, exit={:?}, stdout_len={}, stderr_len={}",
        result.success, result.exit_code, result.stdout.len(), result.stderr.len()
    );

    if !result.success {
        return Err(format!(
            "Claude CLI failed (exit {}): {}",
            result.exit_code.unwrap_or(-1),
            result.stderr
        ));
    }

    let cli_session_id = result.session_id.clone();

    // Try to parse structured output; fall back to a default if output isn't clean JSON
    let mut parsed = parse_implement_output(&result.stdout)?;
    // Attach session_id so the caller can persist it for future --resume
    parsed.session_id = cli_session_id;
    println!("[worker:implement] parsed output: {parsed:?}");
    Ok(parsed)
}

async fn run_review_phase(
    repo_path: &str,
    task_title: &str,
    implementation_summary: &str,
    agent_preferences: Option<&str>,
) -> Result<ReviewOutput, String> {
    let prefs_section = match agent_preferences {
        Some(prefs) if !prefs.trim().is_empty() => format!("\n\n## Project-Specific Instructions\n{prefs}"),
        _ => String::new(),
    };

    let prompt = format!(
        r#"You are a code reviewer for the SUSTN automated agent. Review the changes made on this branch.

## Task That Was Implemented
Title: {task_title}
Summary of changes: {implementation_summary}
{prefs_section}

## Instructions
Review the uncommitted and recent committed changes on this branch. Check:
1. Does the implementation correctly address the task?
2. Are there any bugs or logic errors?
3. Is the code quality acceptable?
4. Are there any security issues introduced?

Output ONLY this JSON (no markdown, no explanation):
{{
  "passed": true or false,
  "feedback": "Explanation of issues found, or 'Looks good' if passed",
  "issues": ["list", "of", "specific", "issues"] or []
}}"#
    );

    println!("[worker:review] invoking Claude CLI — prompt_len={}", prompt.len());
    let result = invoke_claude_cli(repo_path, &prompt, WORK_TIMEOUT_SECS, None, None, None).await?;
    println!(
        "[worker:review] Claude CLI returned — success={}, exit={:?}, stdout_len={}, stderr_len={}",
        result.success, result.exit_code, result.stdout.len(), result.stderr.len()
    );

    if !result.success {
        return Err(format!(
            "Review CLI failed (exit {}): {}",
            result.exit_code.unwrap_or(-1),
            result.stderr
        ));
    }

    let parsed = parse_review_output(&result.stdout);
    println!("[worker:review] parsed output: {parsed:?}");
    parsed
}

fn parse_implement_output(output: &str) -> Result<ImplementOutput, String> {
    let trimmed = output.trim();
    println!("[worker:parse_impl] raw output (first 500 chars): {}", &trimmed[..trimmed.len().min(500)]);

    // Try Claude's JSON wrapper first (--output-format json wraps in {"type":"result","result":"..."})
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<ImplementOutput>(result_str) {
                if validate_implement_output(&parsed) {
                    println!("[worker:parse_impl] parsed via JSON wrapper → result field");
                    return Ok(parsed);
                }
            }
            if let Some(parsed) = extract_json_object::<ImplementOutput>(result_str) {
                if validate_implement_output(&parsed) {
                    println!("[worker:parse_impl] parsed via JSON wrapper → extracted from result field");
                    return Ok(parsed);
                }
            }
        }
    }

    // Extract from prose (don't try direct parse — the CLI wrapper is valid JSON
    // and since all ImplementOutput fields are Option, serde would deserialize it
    // as all-None, producing a false positive)
    if let Some(parsed) = extract_json_object::<ImplementOutput>(trimmed) {
        if validate_implement_output(&parsed) {
            println!("[worker:parse_impl] parsed via JSON extraction from prose");
            return Ok(parsed);
        }
    }

    let preview = &trimmed[..trimmed.len().min(200)];
    Err(format!(
        "Could not parse implement output as structured JSON. Raw output: {preview}"
    ))
}

fn parse_review_output(output: &str) -> Result<ReviewOutput, String> {
    let trimmed = output.trim();
    println!("[worker:parse_review] raw output (first 500 chars): {}", &trimmed[..trimmed.len().min(500)]);

    // Try Claude's JSON wrapper first (--output-format json wraps in {"type":"result","result":"..."})
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<ReviewOutput>(result_str) {
                if validate_review_output(&parsed) {
                    println!("[worker:parse_review] parsed via JSON wrapper → result field");
                    return Ok(parsed);
                }
            }
            if let Some(parsed) = extract_json_object::<ReviewOutput>(result_str) {
                if validate_review_output(&parsed) {
                    println!("[worker:parse_review] parsed via JSON wrapper → extracted from result field");
                    return Ok(parsed);
                }
            }
        }
    }

    // Extract from prose (skip direct parse — same all-Option false positive risk)
    if let Some(parsed) = extract_json_object::<ReviewOutput>(trimmed) {
        if validate_review_output(&parsed) {
            println!("[worker:parse_review] parsed via JSON extraction from prose");
            return Ok(parsed);
        }
    }

    let preview = &trimmed[..trimmed.len().min(200)];
    Err(format!(
        "Could not parse review output as structured JSON. Raw output: {preview}"
    ))
}

/// Validate that an ImplementOutput has at least one meaningful field.
/// Prevents false positives from deserializing unrelated JSON (e.g. the CLI wrapper)
/// where all Option fields silently become None.
fn validate_implement_output(output: &ImplementOutput) -> bool {
    output.summary.is_some() || output.files_modified.is_some() || output.tests_added.is_some()
}

/// Validate that a ReviewOutput has at least the required `passed` field.
fn validate_review_output(output: &ReviewOutput) -> bool {
    output.passed.is_some()
}

/// Extract a JSON object from text that may contain surrounding prose.
fn extract_json_object<T: serde::de::DeserializeOwned>(text: &str) -> Option<T> {
    let start = text.find('{')?;
    let mut depth = 0;
    let mut end = None;

    for (i, ch) in text[start..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(start + i + 1);
                    break;
                }
            }
            _ => {}
        }
    }

    let end = end?;
    serde_json::from_str::<T>(&text[start..end]).ok()
}
