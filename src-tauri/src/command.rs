#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to SUSTN.", name)
}

#[tauri::command]
pub async fn open_in_app(path: String, app: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-a")
        .arg(&app)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open {app}: {e}"))?;
    Ok(())
}
