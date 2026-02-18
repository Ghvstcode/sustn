mod auth;
mod command;
pub mod migrations;
mod preflight;
mod repository;

const DB_URL: &str = "sqlite:sustn.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations::migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            command::greet,
            auth::generate_auth_id,
            preflight::check_git_installed,
            preflight::check_claude_installed,
            preflight::check_claude_authenticated,
            preflight::check_gh_installed,
            repository::validate_git_repo,
            repository::generate_repo_id,
            repository::generate_task_id,
            repository::clone_repository,
            repository::git_pull,
            repository::get_default_clone_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
