use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct CheckResult {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthCheckResult {
    pub authenticated: bool,
}

fn run_version_check(program: &str, args: &[&str]) -> CheckResult {
    match Command::new(program).args(args).output() {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let version = stdout.lines().next().map(|l| l.trim().to_string());
                CheckResult {
                    installed: true,
                    version,
                }
            } else {
                CheckResult {
                    installed: false,
                    version: None,
                }
            }
        }
        Err(_) => CheckResult {
            installed: false,
            version: None,
        },
    }
}

#[tauri::command]
pub fn check_git_installed() -> CheckResult {
    run_version_check("git", &["--version"])
}

#[tauri::command]
pub fn check_claude_installed() -> CheckResult {
    run_version_check("claude", &["--version"])
}

#[tauri::command]
pub fn check_claude_authenticated() -> AuthCheckResult {
    // Check if ~/.claude directory exists and has config,
    // which indicates the user has run claude at least once.
    // A more robust check would be to run `claude auth status`
    // but that may hang if the CLI prompts for input.
    let home = dirs_next().unwrap_or_default();
    let claude_dir = std::path::Path::new(&home).join(".claude");

    if claude_dir.exists() {
        // Check for credentials file or config that indicates auth
        let has_config = claude_dir.join("statsig_metadata.json").exists()
            || claude_dir.join("credentials.json").exists()
            || claude_dir.join("stats-cache.json").exists();

        AuthCheckResult {
            authenticated: has_config,
        }
    } else {
        AuthCheckResult {
            authenticated: false,
        }
    }
}

#[tauri::command]
pub fn check_gh_installed() -> CheckResult {
    run_version_check("gh", &["--version"])
}

fn dirs_next() -> Option<String> {
    std::env::var("HOME").ok()
}
