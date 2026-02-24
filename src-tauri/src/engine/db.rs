use std::path::Path;

use rusqlite::Connection;

use super::budget::BudgetConfig;
use super::scanner::ScannedTask;

/// Read the budget config from the SQLite database.
/// Overlays the global "Budget ceiling" setting from `global_settings` onto the config,
/// since that's what the user actually controls via the UI.
/// Falls back to BudgetConfig::default() if the row doesn't exist or the DB can't be read.
pub fn read_budget_config(app_data_dir: &Path) -> BudgetConfig {
    let db_path = app_data_dir.join("sustn.db");
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            println!("[engine] read_budget_config — failed to open DB: {e}");
            return BudgetConfig::default();
        }
    };

    let mut config = conn
        .query_row(
            "SELECT weekly_token_budget, max_usage_percent, reserve_percent, billing_mode FROM budget_config WHERE id = 1",
            [],
            |row| {
                Ok(BudgetConfig {
                    weekly_token_budget: row.get(0)?,
                    max_usage_percent: row.get(1)?,
                    reserve_percent: row.get(2)?,
                    billing_mode: row.get(3)?,
                })
            },
        )
        .unwrap_or_else(|e| {
            println!("[engine] read_budget_config — query failed, using defaults: {e}");
            BudgetConfig::default()
        });

    // Override max_usage_percent with the global "Budget ceiling" slider value.
    // The ceiling already accounts for the reserve (e.g. 75% ceiling = 25% reserved),
    // so we zero out the separate reserve_percent.
    if let Ok(ceiling) = read_global_setting_int(&conn, "budget_ceiling_percent") {
        config.max_usage_percent = ceiling;
        config.reserve_percent = 0;
    }

    config
}

/// Read the effective budget ceiling percent for a specific project.
/// Returns the per-project override if set, otherwise the global ceiling.
pub fn read_effective_ceiling_percent(app_data_dir: &Path, repository_id: &str) -> i32 {
    let db_path = app_data_dir.join("sustn.db");
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            println!("[engine] read_effective_ceiling_percent — failed to open DB: {e}");
            return 75; // default
        }
    };

    // Check per-project override first
    let project_override: Option<i32> = conn
        .query_row(
            "SELECT override_budget_ceiling_percent FROM agent_config WHERE repository_id = ?1",
            [repository_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    if let Some(override_pct) = project_override {
        return override_pct;
    }

    // Fall back to global ceiling
    read_global_setting_int(&conn, "budget_ceiling_percent").unwrap_or(75)
}

/// Read an integer value from the global_settings key-value table.
fn read_global_setting_int(conn: &Connection, key: &str) -> Result<i32, rusqlite::Error> {
    let val: String = conn.query_row(
        "SELECT value FROM global_settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )?;
    val.parse::<i32>().map_err(|_| {
        rusqlite::Error::InvalidParameterName(format!("Cannot parse '{val}' as i32 for key {key}"))
    })
}

/// Read project-specific preferences (agent instructions & scan focus) from `agent_config`.
/// Returns `(agent_preferences, scan_preferences)` — both optional.
pub fn read_project_preferences(
    app_data_dir: &Path,
    repository_id: &str,
) -> (Option<String>, Option<String>) {
    let db_path = app_data_dir.join("sustn.db");
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            println!("[engine] read_project_preferences — failed to open DB: {e}");
            return (None, None);
        }
    };

    conn.query_row(
        "SELECT agent_preferences, scan_preferences FROM agent_config WHERE repository_id = ?1",
        [repository_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    )
    .unwrap_or_else(|_| (None, None))
}

/// Save scanned tasks directly to the SQLite database from Rust.
/// Used by Pass 2 (deep scan) which runs in the background and needs
/// to persist results even if the frontend isn't listening.
///
/// Deduplicates against existing task titles (case-insensitive) to avoid
/// inserting duplicates of tasks that already exist (e.g., from Pass 1 or
/// previous scans, including tasks that may be in_progress).
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
    // Set busy timeout so concurrent writes (from Tauri SQL plugin) don't
    // immediately fail with SQLITE_BUSY — wait up to 10s for the lock.
    let _ = conn.busy_timeout(std::time::Duration::from_secs(10));

    // Load existing task titles for dedup (case-insensitive)
    let mut existing_titles: std::collections::HashSet<String> = std::collections::HashSet::new();
    {
        let mut stmt = conn
            .prepare("SELECT LOWER(TRIM(title)) FROM tasks WHERE repository_id = ?1")
            .map_err(|e| format!("Failed to prepare dedup query: {e}"))?;
        let rows = stmt
            .query_map([repository_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query existing titles: {e}"))?;
        for row in rows {
            if let Ok(title) = row {
                existing_titles.insert(title);
            }
        }
    }

    // Get the current max sort_order for this repository
    let max_sort: f64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0.0) FROM tasks WHERE repository_id = ?1",
            [repository_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    let mut inserted_ids = Vec::new();
    let mut insert_offset = 0usize;

    for task in tasks.iter() {
        let normalized = task.title.to_lowercase().trim().to_string();
        if existing_titles.contains(&normalized) {
            println!(
                "[engine] save_scanned_tasks — skipping duplicate: '{}'",
                task.title
            );
            continue;
        }

        let task_id = uuid::Uuid::new_v4().to_string();
        let sort_order = max_sort + (insert_offset as f64 + 1.0);
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

        existing_titles.insert(normalized);
        inserted_ids.push(task_id);
        insert_offset += 1;
    }

    println!(
        "[engine] save_scanned_tasks — saved {} tasks to DB for repository {repository_id} ({} duplicates skipped)",
        inserted_ids.len(),
        tasks.len() - inserted_ids.len(),
    );

    Ok(inserted_ids)
}
