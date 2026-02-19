use std::path::Path;

use rusqlite::Connection;

use super::scanner::ScannedTask;

/// Save scanned tasks directly to the SQLite database from Rust.
/// Used by Pass 2 (deep scan) which runs in the background and needs
/// to persist results even if the frontend isn't listening.
///
/// Returns the list of inserted task IDs.
pub fn save_scanned_tasks(
    app_data_dir: &Path,
    repository_id: &str,
    tasks: &[ScannedTask],
) -> Result<Vec<String>, String> {
    let db_path = app_data_dir.join("sustn.db");
    let conn = Connection::open(&db_path).map_err(|e| {
        format!("Failed to open database at {}: {e}", db_path.display())
    })?;

    // Get the current max sort_order for this repository
    let max_sort: f64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0.0) FROM tasks WHERE repository_id = ?1",
            [repository_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    let mut inserted_ids = Vec::new();

    for (i, task) in tasks.iter().enumerate() {
        let task_id = uuid::Uuid::new_v4().to_string();
        let sort_order = max_sort + (i as f64 + 1.0);
        let files_json = serde_json::to_string(&task.files_involved).unwrap_or_default();

        conn.execute(
            "INSERT INTO tasks (id, repository_id, title, description, category, state, sort_order, source, estimated_effort, files_involved)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, 'scan', ?7, ?8)",
            rusqlite::params![
                task_id,
                repository_id,
                task.title,
                task.description,
                task.category,
                sort_order,
                task.estimated_effort,
                files_json,
            ],
        )
        .map_err(|e| format!("Failed to insert task '{}': {e}", task.title))?;

        // Insert a task event to record how this task was discovered
        let event_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO task_events (id, task_id, event_type, comment)
             VALUES (?1, ?2, 'created', 'Discovered by deep agent scan')",
            rusqlite::params![event_id, task_id],
        )
        .map_err(|e| format!("Failed to insert task event: {e}"))?;

        inserted_ids.push(task_id);
    }

    println!(
        "[engine] save_scanned_tasks — saved {} tasks to DB for repository {repository_id}",
        inserted_ids.len()
    );

    Ok(inserted_ids)
}
