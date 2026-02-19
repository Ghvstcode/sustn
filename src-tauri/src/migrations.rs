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
        Migration {
            version: 6,
            description: "add agent engine columns to tasks",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
                ALTER TABLE tasks ADD COLUMN estimated_effort TEXT;
                ALTER TABLE tasks ADD COLUMN files_involved TEXT;
                ALTER TABLE tasks ADD COLUMN branch_name TEXT;
                ALTER TABLE tasks ADD COLUMN commit_sha TEXT;
                ALTER TABLE tasks ADD COLUMN tokens_used INTEGER DEFAULT 0;
                ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0;
                ALTER TABLE tasks ADD COLUMN last_error TEXT;
                ALTER TABLE tasks ADD COLUMN started_at DATETIME;
                ALTER TABLE tasks ADD COLUMN completed_at DATETIME;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create agent engine tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS agent_config (
                    repository_id TEXT PRIMARY KEY NOT NULL REFERENCES repositories(id),
                    enabled INTEGER NOT NULL DEFAULT 1,
                    schedule_mode TEXT NOT NULL DEFAULT 'always',
                    schedule_window_start TEXT,
                    schedule_window_end TEXT,
                    schedule_timezone TEXT DEFAULT 'local',
                    scan_interval_minutes INTEGER DEFAULT 360,
                    last_scan_at DATETIME,
                    last_work_at DATETIME,
                    priority INTEGER NOT NULL DEFAULT 3
                );

                CREATE TABLE IF NOT EXISTS budget_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    weekly_token_budget INTEGER DEFAULT 700000,
                    max_usage_percent INTEGER DEFAULT 80,
                    reserve_percent INTEGER DEFAULT 10,
                    billing_mode TEXT DEFAULT 'subscription'
                );

                INSERT OR IGNORE INTO budget_config (id) VALUES (1);

                CREATE TABLE IF NOT EXISTS usage_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    tokens_today INTEGER NOT NULL,
                    tokens_this_week INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    week_start DATE NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_usage_snapshots_time
                    ON usage_snapshots(timestamp DESC);

                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY NOT NULL,
                    repository_id TEXT NOT NULL REFERENCES repositories(id),
                    task_id TEXT REFERENCES tasks(id),
                    run_type TEXT NOT NULL,
                    started_at DATETIME NOT NULL,
                    completed_at DATETIME,
                    status TEXT NOT NULL DEFAULT 'running',
                    tokens_used INTEGER DEFAULT 0,
                    error TEXT,
                    output TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_agent_runs_repo
                    ON agent_runs(repository_id);
                CREATE INDEX IF NOT EXISTS idx_agent_runs_task
                    ON agent_runs(task_id);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add default_branch to repositories and base_branch to tasks",
            sql: r#"
                ALTER TABLE repositories ADD COLUMN default_branch TEXT DEFAULT 'main';
                ALTER TABLE tasks ADD COLUMN base_branch TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create task_messages table for chat interface",
            sql: r#"
                CREATE TABLE IF NOT EXISTS task_messages (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    role TEXT NOT NULL DEFAULT 'user',
                    content TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX idx_task_messages_task_id ON task_messages(task_id);
            "#,
            kind: MigrationKind::Up,
        },
    ]
}
