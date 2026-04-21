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
        Migration {
            version: 10,
            description: "add unique index on repository path",
            sql: r#"
                CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_path ON repositories(path);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "create global_settings table and add project override columns",
            sql: r#"
                CREATE TABLE IF NOT EXISTS global_settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                INSERT OR IGNORE INTO global_settings (key, value) VALUES
                    ('notifications_enabled', 'false'),
                    ('sound_enabled', 'false'),
                    ('sound_preset', 'chime'),
                    ('auto_create_prs', 'false'),
                    ('delete_branch_on_dismiss', 'false'),
                    ('branch_prefix_mode', 'sustn'),
                    ('branch_prefix_custom', ''),
                    ('branch_name_style', 'slug'),
                    ('default_base_branch', 'main'),
                    ('remote_origin', 'origin'),
                    ('agent_mode', 'scheduled'),
                    ('schedule_days', 'mon,tue,wed,thu,fri,sat,sun'),
                    ('schedule_start', '00:00'),
                    ('schedule_end', '06:00'),
                    ('schedule_timezone', ''),
                    ('scan_frequency', 'daily'),
                    ('budget_ceiling_percent', '75'),
                    ('show_budget_in_sidebar', 'true');

                ALTER TABLE agent_config ADD COLUMN override_base_branch TEXT;
                ALTER TABLE agent_config ADD COLUMN override_remote_origin TEXT;
                ALTER TABLE agent_config ADD COLUMN override_branch_prefix_mode TEXT;
                ALTER TABLE agent_config ADD COLUMN override_branch_prefix_custom TEXT;
                ALTER TABLE agent_config ADD COLUMN override_budget_ceiling_percent INTEGER;
                ALTER TABLE agent_config ADD COLUMN agent_preferences TEXT;
                ALTER TABLE agent_config ADD COLUMN scan_preferences TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add session_id to tasks for Claude CLI conversation resumption",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN session_id TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add Linear integration columns and sync config table",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN linear_issue_id TEXT;
                ALTER TABLE tasks ADD COLUMN linear_identifier TEXT;
                ALTER TABLE tasks ADD COLUMN linear_url TEXT;

                CREATE INDEX IF NOT EXISTS idx_tasks_linear_issue
                    ON tasks(linear_issue_id) WHERE linear_issue_id IS NOT NULL;

                CREATE TABLE IF NOT EXISTS linear_sync_config (
                    id TEXT PRIMARY KEY NOT NULL,
                    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
                    linear_team_id TEXT NOT NULL,
                    linear_team_name TEXT NOT NULL,
                    linear_project_id TEXT,
                    linear_project_name TEXT,
                    auto_sync INTEGER NOT NULL DEFAULT 0,
                    filter_labels TEXT,
                    last_sync_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_linear_sync_repo
                    ON linear_sync_config(repository_id);

                INSERT OR IGNORE INTO global_settings (key, value) VALUES
                    ('linear_api_key', ''),
                    ('linear_enabled', 'false');
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add sync_schedule to linear_sync_config",
            sql: r#"
                ALTER TABLE linear_sync_config ADD COLUMN sync_schedule TEXT NOT NULL DEFAULT 'manual';
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "increase default weekly_token_budget from 700k to 5M",
            sql: r#"
                UPDATE budget_config
                SET weekly_token_budget = 5000000
                WHERE weekly_token_budget = 700000;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add PR lifecycle management tables and columns",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN pr_state TEXT;
                ALTER TABLE tasks ADD COLUMN pr_number INTEGER;
                ALTER TABLE tasks ADD COLUMN pr_review_cycles INTEGER DEFAULT 0;

                CREATE TABLE IF NOT EXISTS pr_reviews (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    github_review_id INTEGER NOT NULL,
                    reviewer TEXT NOT NULL,
                    state TEXT NOT NULL,
                    body TEXT,
                    submitted_at DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_pr_reviews_task
                    ON pr_reviews(task_id);

                CREATE TABLE IF NOT EXISTS pr_comments (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    github_comment_id INTEGER NOT NULL,
                    in_reply_to_id INTEGER,
                    reviewer TEXT NOT NULL,
                    body TEXT NOT NULL,
                    path TEXT,
                    line INTEGER,
                    side TEXT,
                    commit_id TEXT,
                    classification TEXT,
                    our_reply TEXT,
                    addressed_in_commit TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_pr_comments_task
                    ON pr_comments(task_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_comments_github_id
                    ON pr_comments(github_comment_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_reviews_github_id
                    ON pr_reviews(github_review_id);

                INSERT OR IGNORE INTO global_settings (key, value) VALUES
                    ('pr_lifecycle_enabled', 'true'),
                    ('max_review_cycles', '5');
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 17: per-repo PR auto-reply override
        Migration {
            version: 17,
            description: "add per-repo pr auto-reply override",
            sql: r#"
                ALTER TABLE agent_config ADD COLUMN override_pr_auto_reply INTEGER;
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 18: worktree path for task isolation
        Migration {
            version: 18,
            description: "add worktree_path to tasks",
            sql: r#"
                ALTER TABLE tasks ADD COLUMN worktree_path TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        // Migration 19: persisted agent streaming events per task
        Migration {
            version: 19,
            description: "add task_agent_events table for streamed agent output",
            sql: r#"
                CREATE TABLE IF NOT EXISTS task_agent_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    event_type TEXT,
                    blocks_json TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_task_agent_events_task
                    ON task_agent_events(task_id);
            "#,
            kind: MigrationKind::Up,
        },
    ]
}
