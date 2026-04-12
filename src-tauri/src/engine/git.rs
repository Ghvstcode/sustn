use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct GitResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

pub(crate) fn run_git(cwd: &str, args: &[&str]) -> GitResult {
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

/// Create and checkout a new branch starting from a specific base branch.
pub fn create_branch_from(cwd: &str, branch_name: &str, base_branch: &str) -> GitResult {
    run_git(cwd, &["checkout", "-b", branch_name, base_branch])
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

/// Check if the current branch has any commits ahead of the given base branch.
pub fn has_commits_ahead(cwd: &str, base_branch: &str) -> bool {
    let result = run_git(cwd, &["rev-list", "--count", &format!("{base_branch}..HEAD")]);
    result.success && result.output.trim().parse::<u32>().unwrap_or(0) > 0
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

/// Get a unified diff between two branches.
pub fn diff_branches(cwd: &str, base_branch: &str, head_branch: &str) -> GitResult {
    run_git(cwd, &["diff", &format!("{}...{}", base_branch, head_branch)])
}

/// Get diff statistics (files changed, insertions, deletions) between two branches.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileStat {
    pub file: String,
    pub additions: u32,
    pub deletions: u32,
}

pub fn diff_stat(cwd: &str, base_branch: &str, head_branch: &str) -> Result<Vec<DiffFileStat>, String> {
    let result = run_git(
        cwd,
        &["diff", "--numstat", &format!("{}...{}", base_branch, head_branch)],
    );
    if !result.success {
        return Err(result.error.unwrap_or_else(|| "git diff --numstat failed".to_string()));
    }

    Ok(result
        .output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() == 3 {
                let additions = parts[0].parse::<u32>().unwrap_or(0);
                let deletions = parts[1].parse::<u32>().unwrap_or(0);
                Some(DiffFileStat {
                    file: parts[2].to_string(),
                    additions,
                    deletions,
                })
            } else {
                None
            }
        })
        .collect())
}

/// Known environment issues that can be detected from git error output.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentIssue {
    pub error: String,
    pub fix_command: Option<String>,
    pub fix_label: Option<String>,
}

/// Run a quick git health check and return any detected environment issues.
pub fn preflight_check(cwd: &str) -> Option<EnvironmentIssue> {
    let result = run_git(cwd, &["status", "--porcelain"]);
    if result.success {
        return None;
    }

    let stderr = result.error.unwrap_or_default();
    detect_environment_issue(&stderr)
}

/// Pattern-match known environment errors and provide actionable fixes.
fn detect_environment_issue(stderr: &str) -> Option<EnvironmentIssue> {
    if stderr.contains("Xcode license") || stderr.contains("xcodebuild -license") {
        return Some(EnvironmentIssue {
            error: "Xcode license has not been accepted. Git requires the Xcode command line tools license.".to_string(),
            fix_command: Some("sudo xcodebuild -license accept".to_string()),
            fix_label: Some("Accept Xcode License".to_string()),
        });
    }

    if stderr.contains("not a git repository") {
        return Some(EnvironmentIssue {
            error: "This directory is not a git repository.".to_string(),
            fix_command: None,
            fix_label: None,
        });
    }

    if stderr.contains("command not found") || stderr.contains("No such file or directory") {
        return Some(EnvironmentIssue {
            error: "Git is not installed or not found in PATH.".to_string(),
            fix_command: Some("xcode-select --install".to_string()),
            fix_label: Some("Install Command Line Tools".to_string()),
        });
    }

    // Unknown error — return it as-is without a fix command
    Some(EnvironmentIssue {
        error: stderr.to_string(),
        fix_command: None,
        fix_label: None,
    })
}

/// Detect the default branch for a repository.
/// Tries `git symbolic-ref --short refs/remotes/origin/HEAD` first (works for
/// repos with a remote), then falls back to the current branch name.
pub fn detect_default_branch(cwd: &str) -> String {
    // Try the remote HEAD pointer first — most reliable for cloned repos.
    let result = run_git(cwd, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if result.success {
        // Output is e.g. "origin/main" — strip the "origin/" prefix.
        let branch = result.output.trim().to_string();
        let branch = branch.strip_prefix("origin/").unwrap_or(&branch).to_string();
        if !branch.is_empty() {
            return branch;
        }
    }

    // Fall back to the current local branch.
    let result = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]);
    if result.success {
        let branch = result.output.trim().to_string();
        // "HEAD" means the repo is in detached HEAD or has no commits yet.
        if !branch.is_empty() && branch != "HEAD" {
            return branch;
        }
    }

    "main".to_string()
}

/// Clone a repository. Runs in the parent directory of `destination`.
/// Uses GIT_TERMINAL_PROMPT=0 to prevent interactive credential prompts
/// from hanging the process. Skips LFS to avoid downloading large
/// binary files that aren't needed for code review.
pub fn clone_repo(url: &str, destination: &str) -> GitResult {
    let dest_path = std::path::Path::new(destination);

    // Create parent directory if needed
    if let Some(parent) = dest_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match Command::new("git")
        .args(["clone", url, destination])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                GitResult {
                    success: true,
                    output: destination.to_string(),
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
            error: Some(format!("Failed to execute git clone: {}", e)),
        },
    }
}

/// Fetch a specific branch from origin and create a local branch.
/// Tries the branch name first, then falls back to `pull/<number>/head`
/// for fork-based PRs where the branch doesn't exist on the upstream remote.
pub fn fetch_branch(cwd: &str, branch_name: &str) -> GitResult {
    fetch_branch_with_pr(cwd, branch_name, None)
}

/// Fetch a branch, with an optional PR number for fork-based PR fallback.
pub fn fetch_branch_with_pr(cwd: &str, branch_name: &str, pr_number: Option<u32>) -> GitResult {
    // Try fetching by branch name first (works for same-repo PRs)
    let refspec = format!(
        "refs/heads/{}:refs/remotes/origin/{}",
        branch_name, branch_name
    );
    let fetch = run_git(cwd, &["fetch", "origin", &refspec]);

    if !fetch.success {
        if let Some(pr_num) = pr_number {
            // Fallback: fetch via GitHub's PR ref (works for fork-based PRs)
            println!(
                "[git] branch {} not found on origin, trying pull/{}/head",
                branch_name, pr_num
            );
            let pr_refspec = format!(
                "refs/pull/{}/head:refs/remotes/origin/{}",
                pr_num, branch_name
            );
            let pr_fetch = run_git(cwd, &["fetch", "origin", &pr_refspec]);
            if !pr_fetch.success {
                return pr_fetch;
            }
        } else {
            return fetch;
        }
    }

    // Delete stale local branch if it exists (may point to wrong commit)
    let _ = run_git(cwd, &["branch", "-D", branch_name]);
    // Create local branch from the fetched ref
    run_git(
        cwd,
        &[
            "branch",
            branch_name,
            &format!("origin/{}", branch_name),
        ],
    )
}

/// Get the remote URL for origin.
pub fn get_remote_url(cwd: &str) -> GitResult {
    run_git(cwd, &["remote", "get-url", "origin"])
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
