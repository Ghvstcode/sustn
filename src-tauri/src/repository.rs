use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct ValidateResult {
    pub valid: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CloneResult {
    pub success: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn validate_git_repo(path: String) -> ValidateResult {
    let repo_path = Path::new(&path);

    if !repo_path.exists() {
        return ValidateResult {
            valid: false,
            error: Some("Directory does not exist".to_string()),
        };
    }

    if !repo_path.is_dir() {
        return ValidateResult {
            valid: false,
            error: Some("Path is not a directory".to_string()),
        };
    }

    let git_dir = repo_path.join(".git");
    if !git_dir.exists() {
        return ValidateResult {
            valid: false,
            error: Some("This directory doesn't have git initialized".to_string()),
        };
    }

    ValidateResult {
        valid: true,
        error: None,
    }
}

#[tauri::command]
pub fn generate_repo_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
pub async fn clone_repository(url: String, destination: String) -> CloneResult {
    // Run blocking git clone on a background thread so the UI stays responsive
    tauri::async_runtime::spawn_blocking(move || {
        let dest_path = Path::new(&destination);

        // Create parent directory if it doesn't exist
        if let Some(parent) = dest_path.parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    return CloneResult {
                        success: false,
                        path: None,
                        error: Some(format!("Failed to create directory: {}", e)),
                    };
                }
            }
        }

        match std::process::Command::new("git")
            .args(["clone", &url, &destination])
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    CloneResult {
                        success: true,
                        path: Some(destination),
                        error: None,
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    CloneResult {
                        success: false,
                        path: None,
                        error: Some(format!("git clone failed: {}", stderr.trim())),
                    }
                }
            }
            Err(e) => CloneResult {
                success: false,
                path: None,
                error: Some(format!("Failed to execute git: {}", e)),
            },
        }
    })
    .await
    .unwrap_or_else(|e| CloneResult {
        success: false,
        path: None,
        error: Some(format!("Clone task panicked: {}", e)),
    })
}

#[derive(Debug, Serialize)]
pub struct PullResult {
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn git_pull(path: String) -> PullResult {
    tauri::async_runtime::spawn_blocking(move || {
        match std::process::Command::new("git")
            .args(["pull"])
            .current_dir(&path)
            .output()
        {
            Ok(output) => {
                if output.status.success() {
                    PullResult {
                        success: true,
                        error: None,
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    PullResult {
                        success: false,
                        error: Some(format!("git pull failed: {}", stderr.trim())),
                    }
                }
            }
            Err(e) => PullResult {
                success: false,
                error: Some(format!("Failed to execute git: {}", e)),
            },
        }
    })
    .await
    .unwrap_or_else(|e| PullResult {
        success: false,
        error: Some(format!("Pull task panicked: {}", e)),
    })
}

#[tauri::command]
pub fn generate_task_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn get_default_clone_dir() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let default_dir = Path::new(&home).join("sustn").join("repos");

    // Create the directory if it doesn't exist
    if !default_dir.exists() {
        let _ = std::fs::create_dir_all(&default_dir);
    }

    default_dir.to_string_lossy().to_string()
}
