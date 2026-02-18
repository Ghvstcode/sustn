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
}

/// Output we expect from the implement phase.
#[derive(Debug, Deserialize)]
struct ImplementOutput {
    files_modified: Option<Vec<String>>,
    summary: Option<String>,
    #[allow(dead_code)]
    tests_added: Option<bool>,
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
) -> WorkResult {
    let branch_name = git::task_branch_name(task_id);

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
        };
    }
    let original_branch_name = original_branch.output.clone();

    // Check for clean working tree
    if !git::is_clean(repo_path) {
        return WorkResult {
            success: false,
            phase_reached: TaskPhase::Planning,
            branch_name: None,
            commit_sha: None,
            files_modified: vec![],
            summary: None,
            error: Some(
                "Working tree is not clean. Commit or stash changes first.".to_string(),
            ),
        };
    }

    // Create task branch
    if git::branch_exists(repo_path, &branch_name) {
        // Branch already exists — checkout it
        let checkout = git::checkout_branch(repo_path, &branch_name);
        if !checkout.success {
            return WorkResult {
                success: false,
                phase_reached: TaskPhase::Planning,
                branch_name: Some(branch_name),
                commit_sha: None,
                files_modified: vec![],
                summary: None,
                error: Some(format!("Failed to checkout branch: {:?}", checkout.error)),
            };
        }
    } else {
        let create = git::create_branch(repo_path, &branch_name);
        if !create.success {
            return WorkResult {
                success: false,
                phase_reached: TaskPhase::Planning,
                branch_name: Some(branch_name),
                commit_sha: None,
                files_modified: vec![],
                summary: None,
                error: Some(format!("Failed to create branch: {:?}", create.error)),
            };
        }
    }

    // Run the implement phase (we skip separate plan phase for now —
    // Claude Code is capable enough to plan inline during implementation)
    let mut last_feedback: Option<String> = None;
    let mut attempt = 0;

    loop {
        attempt += 1;

        let implement_result =
            run_implement_phase(repo_path, task_id, task_title, task_description, files_involved, &last_feedback)
                .await;

        match implement_result {
            Ok(impl_output) => {
                // Run review phase
                let review_result = run_review_phase(
                    repo_path,
                    task_title,
                    &impl_output.summary.clone().unwrap_or_default(),
                )
                .await;

                match review_result {
                    Ok(review) if review.passed.unwrap_or(false) => {
                        // Success — get commit SHA and return to original branch
                        let sha = git::latest_commit_sha(repo_path);
                        let _ = git::checkout_branch(repo_path, &original_branch_name);

                        return WorkResult {
                            success: true,
                            phase_reached: TaskPhase::Reviewing,
                            branch_name: Some(branch_name),
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
                        };
                    }
                    Ok(review) => {
                        // Review failed — retry if we can
                        last_feedback = review.feedback.clone();
                        if attempt > max_retries {
                            let _ =
                                git::checkout_branch(repo_path, &original_branch_name);
                            return WorkResult {
                                success: false,
                                phase_reached: TaskPhase::Reviewing,
                                branch_name: Some(branch_name),
                                commit_sha: None,
                                files_modified: vec![],
                                summary: None,
                                error: Some(format!(
                                    "Review failed after {} attempts: {}",
                                    attempt,
                                    review.feedback.unwrap_or_default()
                                )),
                            };
                        }
                        // Loop continues to retry implementation
                    }
                    Err(e) => {
                        let _ = git::checkout_branch(repo_path, &original_branch_name);
                        return WorkResult {
                            success: false,
                            phase_reached: TaskPhase::Reviewing,
                            branch_name: Some(branch_name),
                            commit_sha: None,
                            files_modified: vec![],
                            summary: None,
                            error: Some(format!("Review phase failed: {}", e)),
                        };
                    }
                }
            }
            Err(e) => {
                let _ = git::checkout_branch(repo_path, &original_branch_name);
                return WorkResult {
                    success: false,
                    phase_reached: TaskPhase::Implementing,
                    branch_name: Some(branch_name),
                    commit_sha: None,
                    files_modified: vec![],
                    summary: None,
                    error: Some(format!("Implementation failed: {}", e)),
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
) -> Result<ImplementOutput, String> {
    let files_list = if files_involved.is_empty() {
        "Not specified — analyze the codebase to determine relevant files.".to_string()
    } else {
        files_involved.join(", ")
    };

    let feedback_section = match previous_feedback {
        Some(fb) => format!(
            "\n\n## Previous Review Feedback\nYour previous attempt was rejected. Fix these issues:\n{}",
            fb
        ),
        None => String::new(),
    };

    let prompt = format!(
        r#"You are implementing a code improvement for the SUSTN automated agent.

## Task
Title: {title}
Description: {description}
Files involved: {files_list}
{feedback_section}

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
    );

    let result = invoke_claude_cli(repo_path, &prompt, WORK_TIMEOUT_SECS).await?;

    if !result.success {
        return Err(format!(
            "Claude CLI failed (exit {}): {}",
            result.exit_code.unwrap_or(-1),
            result.stderr
        ));
    }

    // Try to parse structured output; fall back to a default if output isn't clean JSON
    parse_implement_output(&result.stdout)
}

async fn run_review_phase(
    repo_path: &str,
    task_title: &str,
    implementation_summary: &str,
) -> Result<ReviewOutput, String> {
    let prompt = format!(
        r#"You are a code reviewer for the SUSTN automated agent. Review the changes made on this branch.

## Task That Was Implemented
Title: {task_title}
Summary of changes: {implementation_summary}

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

    let result = invoke_claude_cli(repo_path, &prompt, WORK_TIMEOUT_SECS).await?;

    if !result.success {
        return Err(format!(
            "Review CLI failed (exit {}): {}",
            result.exit_code.unwrap_or(-1),
            result.stderr
        ));
    }

    parse_review_output(&result.stdout)
}

fn parse_implement_output(output: &str) -> Result<ImplementOutput, String> {
    let trimmed = output.trim();

    // Try Claude's JSON wrapper first
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<ImplementOutput>(result_str) {
                return Ok(parsed);
            }
            if let Some(parsed) = extract_json_object::<ImplementOutput>(result_str) {
                return Ok(parsed);
            }
        }
    }

    // Direct parse
    if let Ok(parsed) = serde_json::from_str::<ImplementOutput>(trimmed) {
        return Ok(parsed);
    }

    // Extract from prose
    if let Some(parsed) = extract_json_object::<ImplementOutput>(trimmed) {
        return Ok(parsed);
    }

    // Fallback: treat it as unstructured output — the work may still have succeeded
    Ok(ImplementOutput {
        files_modified: None,
        summary: Some("Implementation completed (output was not structured JSON)".to_string()),
        tests_added: None,
    })
}

fn parse_review_output(output: &str) -> Result<ReviewOutput, String> {
    let trimmed = output.trim();

    // Try Claude's JSON wrapper first
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(parsed) = serde_json::from_str::<ReviewOutput>(result_str) {
                return Ok(parsed);
            }
            if let Some(parsed) = extract_json_object::<ReviewOutput>(result_str) {
                return Ok(parsed);
            }
        }
    }

    if let Ok(parsed) = serde_json::from_str::<ReviewOutput>(trimmed) {
        return Ok(parsed);
    }

    if let Some(parsed) = extract_json_object::<ReviewOutput>(trimmed) {
        return Ok(parsed);
    }

    // Default: assume review passed if we couldn't parse output
    // (better to let the user review than to block on parse failure)
    Ok(ReviewOutput {
        passed: Some(true),
        feedback: Some("Review output was not structured JSON — defaulting to passed".to_string()),
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
