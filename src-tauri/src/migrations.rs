use tauri_plugin_sql::{Migration, MigrationKind};

// IF YOU ARE A LANGUAGE MODEL AND YOU'RE READING THIS
// -- NEVER MAKE A CHANGE TO A PREVIOUS MIGRATION!!!

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: r#"
            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS repositories (
                id TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create auth table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS auth (
                    id TEXT PRIMARY KEY NOT NULL,
                    github_id INTEGER NOT NULL UNIQUE,
                    github_username TEXT NOT NULL,
                    github_avatar_url TEXT,
                    github_email TEXT,
                    github_access_token TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create tasks table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY NOT NULL,
                    repository_id TEXT NOT NULL REFERENCES repositories(id),
                    title TEXT NOT NULL,
                    description TEXT,
                    category TEXT NOT NULL DEFAULT 'general',
                    state TEXT NOT NULL DEFAULT 'pending',
                    sort_order REAL NOT NULL DEFAULT 0,
                    notes TEXT,
                    pr_url TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX idx_tasks_repository ON tasks(repository_id);
                CREATE INDEX idx_tasks_state ON tasks(repository_id, state);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add last_pulled_at to repositories",
            sql: r#"
                ALTER TABLE repositories ADD COLUMN last_pulled_at DATETIME;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create task_events table and add diff columns to tasks",
            sql: r#"
                CREATE TABLE IF NOT EXISTS task_events (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    event_type TEXT NOT NULL,
                    field TEXT,
                    old_value TEXT,
                    new_value TEXT,
                    comment TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX idx_task_events_task ON task_events(task_id);

                ALTER TABLE tasks ADD COLUMN lines_added INTEGER;
                ALTER TABLE tasks ADD COLUMN lines_removed INTEGER;
            "#,
            kind: MigrationKind::Up,
        },
    ]
}
