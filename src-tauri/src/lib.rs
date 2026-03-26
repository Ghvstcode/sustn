#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use tauri::{Emitter, Manager};

mod auth;
mod command;
pub mod engine;
mod engine_commands;
mod menu;
pub mod migrations;
mod preflight;
mod repository;

const DB_URL: &str = "sqlite:sustn.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations::migrations();
    let engine_state = engine::EngineState::new();

    tauri::Builder::default()
        .manage(engine_state)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle();
            let menu = menu::build_menu(handle)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                std::process::exit(0);
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-navigate", "/settings");
                    }
                }
                "docs" => {
                    let _ = tauri_plugin_opener::open_url("https://sustn.app/docs", None::<&str>);
                }
                "report_issue" => {
                    let _ = tauri_plugin_opener::open_url(
                        "https://github.com/sustn/sustn/issues",
                        None::<&str>,
                    );
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            command::greet,
            command::open_in_app,
            auth::generate_auth_id,
            preflight::check_git_installed,
            preflight::check_claude_installed,
            preflight::check_claude_authenticated,
            preflight::check_gh_installed,
            repository::validate_git_repo,
            repository::generate_repo_id,
            repository::generate_task_id,
            repository::get_repo_default_branch,
            repository::clone_repository,
            repository::git_pull,
            repository::get_default_clone_dir,
            repository::list_directory,
            repository::read_file_content,
            engine_commands::engine_get_budget,
            engine_commands::engine_scan_now,
            engine_commands::engine_start_task,
            engine_commands::engine_get_status,
            engine_commands::engine_check_schedule,
            engine_commands::engine_push_branch,
            engine_commands::engine_list_branches,
            engine_commands::engine_get_diff,
            engine_commands::engine_get_diff_stat,
            engine_commands::engine_create_pr,
            engine_commands::engine_augment_tasks,
            engine_commands::run_terminal_command,
            command::set_dock_badge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
