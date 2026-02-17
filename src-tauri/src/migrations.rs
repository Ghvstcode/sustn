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
    ]
}
