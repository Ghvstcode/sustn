use std::fs;
use std::path::Path;

use super::git;

/// Compute the worktree directory path for a task.
/// Uses first 8 chars of the task ID for readability.
pub fn get_worktree_path(repo_path: &str, task_id: &str) -> String {
    let short_id = if task_id.len() >= 8 {
        &task_id[..8]
    } else {
        task_id
    };
    format!("{}/.sustn/worktrees/{}", repo_path, short_id)
}

/// Create a git worktree for a task. Idempotent — if the worktree already
/// exists, returns the existing path without error.
///
/// For new branches: `git worktree add <path> -b <branch> <base>`
/// For existing branches: `git worktree add <path> <branch>`
pub fn create_worktree(
    repo_path: &str,
    task_id: &str,
    branch_name: &str,
    base_branch: &str,
) -> Result<String, String> {
    let wt_path = get_worktree_path(repo_path, task_id);

    // If the worktree directory already exists, verify it's valid
    if Path::new(&wt_path).exists() {
        // Check if it's a valid git worktree by running a git command in it
        let check = git::run_git(&wt_path, &["rev-parse", "--git-dir"]);
        if check.success {
            println!(
                "[worktree] reusing existing worktree at {} for task {}",
                wt_path, task_id
            );
            return Ok(wt_path);
        }
        // Directory exists but isn't a valid worktree — clean it up
        println!(
            "[worktree] removing stale worktree directory at {}",
            wt_path
        );
        let _ = fs::remove_dir_all(&wt_path);
        // Also prune stale worktree entries
        let _ = git::run_git(repo_path, &["worktree", "prune"]);
    }

    // Ensure parent directory exists
    let parent = format!("{}/.sustn/worktrees", repo_path);
    fs::create_dir_all(&parent)
        .map_err(|e| format!("Failed to create worktree directory: {}", e))?;

    // Try to create the worktree
    let result = if git::branch_exists(repo_path, branch_name) {
        // Branch already exists — just check it out in the worktree
        git::run_git(repo_path, &["worktree", "add", &wt_path, branch_name])
    } else {
        // Create a new branch from base
        git::run_git(
            repo_path,
            &[
                "worktree",
                "add",
                &wt_path,
                "-b",
                branch_name,
                base_branch,
            ],
        )
    };

    if result.success {
        println!(
            "[worktree] created worktree at {} (branch: {}, base: {})",
            wt_path, branch_name, base_branch
        );
        Ok(wt_path)
    } else {
        let err = result.error.unwrap_or_else(|| "unknown error".to_string());

        // Handle "already checked out" — find the existing worktree
        if err.contains("already checked out") || err.contains("is already used by worktree") {
            println!(
                "[worktree] branch {} already checked out, looking for existing worktree",
                branch_name
            );
            // The branch is checked out somewhere — list worktrees to find it
            let list = git::run_git(repo_path, &["worktree", "list", "--porcelain"]);
            if list.success {
                for line in list.output.lines() {
                    if let Some(path) = line.strip_prefix("worktree ") {
                        let branch_check = git::current_branch(path);
                        if branch_check.success && branch_check.output == branch_name {
                            println!(
                                "[worktree] found branch {} in existing worktree at {}",
                                branch_name, path
                            );
                            return Ok(path.to_string());
                        }
                    }
                }
            }
        }

        Err(format!(
            "Failed to create worktree for task {}: {}",
            task_id, err
        ))
    }
}

/// Remove a task's worktree. Tolerates missing worktrees.
pub fn remove_worktree(repo_path: &str, task_id: &str) -> Result<(), String> {
    let wt_path = get_worktree_path(repo_path, task_id);

    if !Path::new(&wt_path).exists() {
        // Already gone — prune any stale refs
        let _ = git::run_git(repo_path, &["worktree", "prune"]);
        return Ok(());
    }

    println!("[worktree] removing worktree at {}", wt_path);
    let result = git::run_git(repo_path, &["worktree", "remove", "--force", &wt_path]);

    if result.success {
        Ok(())
    } else {
        // Force-remove the directory if git worktree remove fails
        println!(
            "[worktree] git worktree remove failed, falling back to directory removal: {:?}",
            result.error
        );
        let _ = fs::remove_dir_all(&wt_path);
        let _ = git::run_git(repo_path, &["worktree", "prune"]);
        Ok(())
    }
}

/// Ensure `.sustn/` is in the repo's `.gitignore`.
/// Idempotent — does nothing if the entry already exists.
pub fn ensure_gitignore_entry(repo_path: &str) -> Result<(), String> {
    let gitignore_path = format!("{}/.gitignore", repo_path);
    let path = Path::new(&gitignore_path);

    if path.exists() {
        let content =
            fs::read_to_string(path).map_err(|e| format!("Failed to read .gitignore: {}", e))?;
        // Check if .sustn/ is already ignored (any common form)
        if content.lines().any(|line| {
            let trimmed = line.trim();
            trimmed == ".sustn/" || trimmed == ".sustn" || trimmed == "/.sustn/"
        }) {
            return Ok(());
        }
        // Append the entry
        let suffix = if content.ends_with('\n') { "" } else { "\n" };
        fs::write(path, format!("{}{}.sustn/\n", content, suffix))
            .map_err(|e| format!("Failed to write .gitignore: {}", e))?;
    } else {
        // Create .gitignore with the entry
        fs::write(path, ".sustn/\n")
            .map_err(|e| format!("Failed to create .gitignore: {}", e))?;
    }

    println!("[worktree] added .sustn/ to .gitignore");
    Ok(())
}
