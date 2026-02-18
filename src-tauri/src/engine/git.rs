use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct GitResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

fn run_git(cwd: &str, args: &[&str]) -> GitResult {
    match Command::new("git").args(args).current_dir(cwd).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                GitResult {
                    success: true,
                    output: stdout,
                    error: None,
                }
            } else {
                GitResult {
                    success: false,
                    output: stdout,
                    error: Some(stderr),
                }
            }
        }
        Err(e) => GitResult {
            success: false,
            output: String::new(),
            error: Some(format!("Failed to execute git: {}", e)),
        },
    }
}

/// Get the current branch name.
pub fn current_branch(cwd: &str) -> GitResult {
    run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
}

/// Create and checkout a new branch from the current HEAD.
pub fn create_branch(cwd: &str, branch_name: &str) -> GitResult {
    run_git(cwd, &["checkout", "-b", branch_name])
}

/// Checkout an existing branch.
pub fn checkout_branch(cwd: &str, branch_name: &str) -> GitResult {
    run_git(cwd, &["checkout", branch_name])
}

/// Check if the working tree is clean (no uncommitted changes).
pub fn is_clean(cwd: &str) -> bool {
    let result = run_git(cwd, &["status", "--porcelain"]);
    result.success && result.output.is_empty()
}

/// Push a branch to origin.
pub fn push_branch(cwd: &str, branch_name: &str) -> GitResult {
    run_git(cwd, &["push", "-u", "origin", branch_name])
}

/// Delete a local branch (for cleanup on failure).
pub fn delete_branch(cwd: &str, branch_name: &str) -> GitResult {
    run_git(cwd, &["branch", "-D", branch_name])
}

/// Get the latest commit SHA on the current branch.
pub fn latest_commit_sha(cwd: &str) -> GitResult {
    run_git(cwd, &["rev-parse", "HEAD"])
}

/// Check if a branch exists locally.
pub fn branch_exists(cwd: &str, branch_name: &str) -> bool {
    let result = run_git(
        cwd,
        &["rev-parse", "--verify", &format!("refs/heads/{}", branch_name)],
    );
    result.success
}

/// Stash any uncommitted changes (safety measure before branch operations).
pub fn stash(cwd: &str) -> GitResult {
    run_git(cwd, &["stash", "push", "-m", "sustn-agent-autostash"])
}

/// Pop the most recent stash.
pub fn stash_pop(cwd: &str) -> GitResult {
    run_git(cwd, &["stash", "pop"])
}

/// List all local branches, marking the current one.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

pub fn list_branches(cwd: &str) -> Vec<BranchInfo> {
    let result = run_git(cwd, &["branch", "--format=%(refname:short)\t%(HEAD)"]);
    if !result.success {
        return vec![];
    }

    result
        .output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, '\t').collect();
            if parts.len() == 2 {
                Some(BranchInfo {
                    name: parts[0].trim().to_string(),
                    is_current: parts[1].trim() == "*",
                })
            } else {
                None
            }
        })
        .collect()
}

/// Generate a branch name for a task.
pub fn task_branch_name(task_id: &str) -> String {
    // Use first 8 chars of UUID for readability
    let short_id = if task_id.len() >= 8 {
        &task_id[..8]
    } else {
        task_id
    };
    format!("sustn/{}", short_id)
}
