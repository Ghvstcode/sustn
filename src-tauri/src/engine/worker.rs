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
    /// True when the automated review could not produce a valid verdict
    /// (e.g. the reviewer returned unparseable output on every attempt).
    /// The implementation may still be correct — the user should manually review.
    pub review_inconclusive: bool,
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
            review_inconclusive: false,
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
                review_inconclusive: false,
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
                review_inconclusive: false,
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
                review_inconclusive: false,
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
                            review_inconclusive: false,
                        };
                    }
                    Ok(review) => {
                        // Distinguish between "review found real issues" and
                        // "review output couldn't be parsed" for clear logging.
                        let is_parse_failure = review.feedback.as_deref()
                            .is_some_and(|f| f.contains("not structured JSON"));

                        if is_parse_failure {
                            println!("[worker] REVIEW PARSE FAILURE (attempt {attempt}) — reviewer returned unparseable output, retrying? {}", attempt <= max_retries);
                        } else {
                            println!("[worker] REVIEW REJECTED (attempt {attempt}) — reviewer found issues, retrying? {}", attempt <= max_retries);
                        }

                        last_feedback = review.feedback.clone();
                        if attempt > max_retries {
                            // When retries are exhausted due to parse failures, the
                            // implementation may still be correct — mark as success
                            // but flag review_inconclusive so the user manually reviews
                            // (and auto-PR is skipped).
                            if is_parse_failure {
                                // Capture SHA while still on the task branch (before switching back)
                                let sha = git::latest_commit_sha(repo_path);
                                println!("[worker] REVIEW INCONCLUSIVE — returning success with review_inconclusive flag");
                                let _ =
                                    git::checkout_branch(repo_path, &original_branch_name);
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
                                    error: Some(
                                        "Automated review could not complete — reviewer returned unparseable output on every attempt".to_string(),
                                    ),
                                    session_id: impl_output.session_id,
                                    review_inconclusive: true,
                                };
                            }

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
                                review_inconclusive: false,
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
                            review_inconclusive: false,
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
                    review_inconclusive: false,
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
            r#"The user has provided the following feedback on your previous implementation:

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
            r#"You are implementing a code improvement for the SUSTN automated agent.

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

    // Try Claude's JSON wrapper first
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<ImplementOutput>(result_str) {
                println!("[worker:parse_impl] parsed via JSON wrapper → result field");
                return Ok(parsed);
            }
            if let Some(parsed) = extract_json_object::<ImplementOutput>(result_str) {
                println!("[worker:parse_impl] parsed via JSON wrapper → extracted from result field");
                return Ok(parsed);
            }
        }
    }

    // Direct parse
    if let Ok(parsed) = serde_json::from_str::<ImplementOutput>(trimmed) {
        println!("[worker:parse_impl] parsed via direct JSON");
        return Ok(parsed);
    }

    // Extract from prose
    if let Some(parsed) = extract_json_object::<ImplementOutput>(trimmed) {
        println!("[worker:parse_impl] parsed via JSON extraction from prose");
        return Ok(parsed);
    }

    // Fallback: treat it as unstructured output — the work may still have succeeded
    println!("[worker:parse_impl] FALLBACK — output was not structured JSON");
    Ok(ImplementOutput {
        files_modified: None,
        summary: Some("Implementation completed (output was not structured JSON)".to_string()),
        tests_added: None,
        session_id: None,
    })
}

fn parse_review_output(output: &str) -> Result<ReviewOutput, String> {
    let trimmed = output.trim();
    println!("[worker:parse_review] raw output (first 500 chars): {}", &trimmed[..trimmed.len().min(500)]);

    // Try Claude's JSON wrapper first
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<ReviewOutput>(result_str) {
                println!("[worker:parse_review] parsed via JSON wrapper → result field");
                return Ok(parsed);
            }
            if let Some(parsed) = extract_json_object::<ReviewOutput>(result_str) {
                println!("[worker:parse_review] parsed via JSON wrapper → extracted from result field");
                return Ok(parsed);
            }
        }
    }

    if let Ok(parsed) = serde_json::from_str::<ReviewOutput>(trimmed) {
        println!("[worker:parse_review] parsed via direct JSON");
        return Ok(parsed);
    }

    if let Some(parsed) = extract_json_object::<ReviewOutput>(trimmed) {
        println!("[worker:parse_review] parsed via JSON extraction from prose");
        return Ok(parsed);
    }

    // Default: fail the review when output can't be parsed.
    // This triggers a retry, giving the reviewer another chance to produce valid JSON.
    // If retries are exhausted, the caller handles it as an inconclusive review.
    println!("[worker:parse_review] FALLBACK — defaulting to FAILED (unparseable output)");
    Ok(ReviewOutput {
        passed: Some(false),
        feedback: Some("Review output was not structured JSON — automated review could not complete".to_string()),
        issues: Some(vec![]),
    })
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
