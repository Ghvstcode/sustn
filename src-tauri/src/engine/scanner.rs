use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

use super::invoke_claude_cli;

/// A task discovered by scanning a codebase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedTask {
    pub title: String,
    pub description: String,
    pub category: String,
    pub estimated_effort: String,
    pub files_involved: Vec<String>,
    pub priority: i32,
}

/// Result of a scan operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub success: bool,
    pub tasks_found: Vec<ScannedTask>,
    pub error: Option<String>,
    pub tokens_used: i64,
}

const SCAN_PROMPT: &str = r#"You are a senior product-minded engineer reviewing a codebase for the first time. Your job is to produce a prioritized backlog of tasks — things that would make this codebase better, more complete, more reliable, and more valuable to its users.
You are not just looking for bugs and lint issues. You are evaluating this codebase the way someone who cares about both the product and the engineering would: what's missing for users, what's half-built, what's fragile under the hood, what would you flag before this ships or scales?
Think about:
Product & User Impact:

Features or flows that look started but unfinished (TODOs, stub implementations, placeholder logic, empty handlers, hardcoded values that should be configurable)
Missing edge cases in user-facing flows — what happens when things go wrong, what does the user see?
Accessibility gaps, missing loading states, poor error messages that don't help the user recover
Gaps between what the code does and what a user would reasonably expect it to do

Architecture & Code Health:

Tight coupling, missing abstractions, god files/classes, unclear separation of concerns
Code duplication that should be extracted, overly complex functions, dead code, unused dependencies
Missing or broken dev setup, no linting/formatting config, unclear project structure, missing environment variable documentation

Reliability & Safety:

Error handling gaps — swallowed errors, generic catches, missing user-facing error messages, no retry logic where needed
Security concerns — exposed secrets, missing input validation, unsafe deserialization, missing auth checks, injection vectors
Performance problems — N+1 queries, unbounded loops, missing pagination, synchronous operations that should be async
Missing logging in critical paths, no error tracking, no health checks

Quality & Confidence:

Untested business logic, missing edge case coverage, no integration tests for critical paths
Documentation gaps — public APIs with no docs, complex logic with no explanation, outdated docs that contradict the code

Anything else that stands out as something a thoughtful team would want on their backlog.
For each task, write the description like a well-written ticket from someone who understands both the product and the code. Be specific about what you observed, what the desired state should be, why it matters (to users, to developers, to reliability), which files or modules are involved, and any suggested approach or things to watch out for during implementation. Make descriptions detailed enough that another developer could pick this up and start working without asking questions.
Output ONLY a JSON array with no markdown formatting, no backticks, no explanation before or after — just the raw JSON.
Schema:
[{
"title": "Short but descriptive title (under 80 chars)",
"description": "Detailed description written like a real engineering ticket.",
"category": "feature" | "tech_debt" | "tests" | "docs" | "security" | "performance" | "dx" | "observability" | "general",
"estimated_effort": "low" | "medium" | "high",
"files_involved": ["path/to/file1.ts", "path/to/file2.ts"],
"priority": 1
}]
Priority scale:
1 — Critical: security vulnerabilities, data loss risks, broken core functionality
2 — High: significant bugs, missing error handling in critical paths, unfinished core features
3 — Medium: meaningful improvements to reliability, test coverage, or user experience
4 — Low: code quality improvements, minor refactors, nice-to-have enhancements
5 — Trivial: cosmetic issues, minor doc updates, style inconsistencies
Here are examples of good task output:
[
{
"title": "Implement proper error recovery in checkout flow",
"description": "The checkout handler in src/handlers/checkout.rs catches payment processing errors with a generic catch-all that returns a 500 to the user with no context. If a payment fails due to insufficient funds, a network timeout, or a card decline, the user gets the same unhelpful 'Something went wrong' message and their cart state becomes ambiguous — they don't know if they were charged or not.\n\nThis should be broken out into specific error types with user-friendly messages that tell the user what happened and what they can do about it. Payment declines should show 'Your card was declined, please try another payment method.' Timeouts should show 'We couldn't confirm your payment, please check your order history before retrying.' The cart state should be preserved in all failure cases so the user can retry without re-adding items.\n\nLook at the PaymentError enum in src/models/errors.rs — the variants are already defined but nothing maps them to user-facing responses.",
"category": "feature",
"estimated_effort": "medium",
"files_involved": ["src/handlers/checkout.rs", "src/models/errors.rs", "src/templates/checkout.html"],
"priority": 2
},
{
"title": "Complete the half-built notification preferences system",
"description": "There's a notification preferences module in src/services/notifications/preferences.rs that has the data model and database schema defined but the actual logic is entirely stubbed out. The functions save_preferences and get_preferences both have TODO comments and return hardcoded defaults. The UI for this exists in the settings page (src/components/SettingsNotifications.tsx) with working toggles, but they don't persist — every page reload resets them.\n\nThis looks like a feature that was started and abandoned mid-implementation. The schema migration already ran (migrations/20240315_notification_prefs.sql) so the table exists in production. The remaining work is wiring up the service functions to actually read/write from the database and connecting the frontend toggles to the API endpoint which also returns hardcoded data (see src/handlers/api/settings.rs line 142).",
"category": "feature",
"estimated_effort": "medium",
"files_involved": ["src/services/notifications/preferences.rs", "src/components/SettingsNotifications.tsx", "src/handlers/api/settings.rs"],
"priority": 2
},
{
"title": "Add rate limiting to public API endpoints",
"description": "None of the public API endpoints in src/handlers/api/ have any rate limiting. The authentication endpoints (login, register, password reset) are especially concerning — an attacker could brute force credentials or trigger thousands of password reset emails without any throttling.\n\nAt minimum, auth endpoints should be rate limited per IP (something like 10 requests per minute for login, 3 per hour for password reset). The general API endpoints should have a per-user rate limit based on their API key tier. The middleware infrastructure for this doesn't exist yet — consider using tower's RateLimitLayer or implementing a token bucket in Redis since the app already uses Redis for sessions (see src/config/redis.rs).",
"category": "security",
"estimated_effort": "high",
"files_involved": ["src/handlers/api/auth.rs", "src/handlers/api/mod.rs", "src/middleware/mod.rs", "src/config/redis.rs"],
"priority": 1
},
{
"title": "Remove dead feature flag code for v1 migration",
"description": "There are remnants of a feature flag system for a 'v1 migration' scattered across the codebase. The flag is hardcoded to true in src/config/features.rs and every branch that checks it always takes the enabled path. The disabled code paths reference database tables and API contracts that no longer exist based on the current schema.\n\nThis adds unnecessary complexity to reading the code — there are about 15 conditional blocks across 8 files that always evaluate the same way. Removing the dead branches and the flag itself would simplify the codebase meaningfully. Search for 'v1_migration' and 'ENABLE_V1_COMPAT' to find all instances.",
"category": "tech_debt",
"estimated_effort": "low",
"files_involved": ["src/config/features.rs", "src/handlers/api/users.rs", "src/handlers/api/projects.rs", "src/services/migration_compat.rs"],
"priority": 4
}
]
Rules:

Write descriptions that are detailed enough for another developer to pick up and implement without needing to ask questions.
Each task should be independently implementable — if a task depends on another, note it in the description.
If you see something half-built or clearly unfinished, absolutely flag it. These are some of the most valuable tasks to surface.
Don't limit yourself to just maintenance and cleanup. If the codebase is missing something obvious it should have, that's a valid task.
Think about what would make the product better for users, not just what would make the code cleaner for developers.
Aim for 10-25 tasks depending on codebase size and state. Fewer for small/clean repos, more for larger or messier ones.
Output ONLY the JSON array, nothing else."#;

// --- File collection for Pass 1 ---

/// Directories to skip when collecting source files.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "vendor",
    ".turbo",
    ".cache",
    "coverage",
];

/// Source file extensions to include.
const SOURCE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "kt", "rb", "c", "cpp", "h", "hpp",
    "toml", "yaml", "yml", "json", "sql", "sh", "md", "css", "scss", "html", "svelte", "vue",
];

/// Files to always skip regardless of extension.
const SKIP_FILES: &[&str] = &[
    "Cargo.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "composer.lock",
    "Gemfile.lock",
    "poetry.lock",
];

/// Max lines per file before truncation.
const MAX_LINES_PER_FILE: usize = 500;

/// Max total content size in bytes.
const MAX_TOTAL_BYTES: usize = 200 * 1024; // 200KB

/// Collect source files from a repository and format them as markdown context.
/// Matches nightshift's format: `# Context Files\n\n## File: <path>\n\n```\n<content>\n```\n\n`
pub fn collect_source_files(repo_path: &str) -> Result<String, String> {
    let repo = Path::new(repo_path);
    if !repo.is_dir() {
        return Err(format!("Repository path is not a directory: {repo_path}"));
    }

    let mut output = String::from("# Context Files\n\n");
    let mut total_bytes: usize = output.len();
    let mut files_included = 0u32;
    let mut files_skipped_size = 0u32;

    let walker = WalkDir::new(repo_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            // Skip hidden directories and known skip dirs
            if entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy();
                if name.starts_with('.') && name != "." {
                    return false;
                }
                if SKIP_DIRS.contains(&name.as_ref()) {
                    return false;
                }
            }
            true
        });

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy();

        // Skip known lock/binary files
        if SKIP_FILES.contains(&file_name.as_ref()) {
            continue;
        }

        // Skip minified files
        if file_name.ends_with(".min.js") || file_name.ends_with(".min.css") {
            continue;
        }

        // Check extension
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !SOURCE_EXTENSIONS.contains(&ext) {
            continue;
        }

        // Read file content
        let content = match std::fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue, // skip binary/unreadable files
        };

        // Truncate long files
        let lines: Vec<&str> = content.lines().collect();
        let (display_content, was_truncated) = if lines.len() > MAX_LINES_PER_FILE {
            let truncated: String = lines[..MAX_LINES_PER_FILE].join("\n");
            (
                format!(
                    "{}\n... (truncated, {} lines total)",
                    truncated,
                    lines.len()
                ),
                true,
            )
        } else {
            (content, false)
        };

        // Build the file block
        let relative_path = entry
            .path()
            .strip_prefix(repo_path)
            .unwrap_or(entry.path())
            .to_string_lossy();

        let block = format!("## File: {relative_path}\n\n```\n{display_content}\n```\n\n");

        // Check total size cap
        if total_bytes + block.len() > MAX_TOTAL_BYTES {
            files_skipped_size += 1;
            continue;
        }

        output.push_str(&block);
        total_bytes += block.len();
        files_included += 1;

        let _ = was_truncated; // suppress unused warning
    }

    println!(
        "[engine] collect_source_files — included={files_included} files, total_bytes={total_bytes}, skipped_for_size={files_skipped_size}"
    );

    if files_included == 0 {
        return Err("No source files found in repository".to_string());
    }

    Ok(output)
}

// --- Pass 1: Quick scan (pre-read files, no tool use) ---

/// Scan a repository using pre-read file context (Pass 1 — fast, ~30-60 seconds).
/// Files are collected and passed via stdin so Claude doesn't need tool calls.
pub async fn scan_repository(repo_path: &str, scan_preferences: Option<&str>) -> ScanResult {
    // Collect source files
    let file_context = match collect_source_files(repo_path) {
        Ok(ctx) => ctx,
        Err(e) => {
            return ScanResult {
                success: false,
                tasks_found: vec![],
                error: Some(format!("Failed to collect source files: {e}")),
                tokens_used: 0,
            };
        }
    };

    // Augment prompt: no tool use, fewer tasks for fast pass 1
    let scan_focus_section = match scan_preferences {
        Some(prefs) if !prefs.trim().is_empty() => format!("\n\n## Project-Specific Scan Focus\n{prefs}"),
        _ => String::new(),
    };
    let augmented_prompt = format!(
        "{SCAN_PROMPT}{scan_focus_section}\n\n\
        IMPORTANT: The repository source files have been provided to you via stdin. \
        Analyze them directly — do NOT use tools to read additional files.\n\n\
        OVERRIDE: For this quick scan, return only the 3-5 highest-priority tasks. \
        Focus on the most impactful issues. Keep descriptions concise but actionable."
    );

    let timeout_secs = 300; // 5 minutes

    let start = std::time::Instant::now();
    let result = invoke_claude_cli(repo_path, &augmented_prompt, timeout_secs, Some(&file_context), None, None).await;
    let elapsed = start.elapsed();
    println!("[engine] pass 1 scan took {:.1}s", elapsed.as_secs_f64());

    handle_cli_result(result)
}

// --- Pass 2: Deep scan (full tool access, background) ---

/// Deep scan a repository with full tool access (Pass 2 — slower, runs in background).
/// Claude can follow imports, trace call chains, run commands, etc.
/// `existing_titles` is the list of task titles from Pass 1 for deduplication.
pub async fn deep_scan_repository(
    repo_path: &str,
    existing_titles: &[String],
    scan_preferences: Option<&str>,
) -> ScanResult {
    let dedup_list = existing_titles
        .iter()
        .map(|t| format!("- {t}"))
        .collect::<Vec<_>>()
        .join("\n");

    let scan_focus_section = match scan_preferences {
        Some(prefs) if !prefs.trim().is_empty() => format!("\n\n## Project-Specific Scan Focus\n{prefs}"),
        _ => String::new(),
    };
    let deep_prompt = format!(
        "{SCAN_PROMPT}{scan_focus_section}\n\n\
        IMPORTANT: The following tasks have already been identified by a quick scan. \
        Do NOT duplicate these — focus on finding issues that require deeper analysis: \
        cross-module problems, subtle bugs, integration issues, things that aren't visible \
        from reading files in isolation.\n\n\
        Already identified tasks:\n{dedup_list}"
    );

    let timeout_secs = 600; // 10 minutes — Claude uses tools here

    let start = std::time::Instant::now();
    let result = invoke_claude_cli(repo_path, &deep_prompt, timeout_secs, None, None, None).await;
    let elapsed = start.elapsed();
    println!("[engine] pass 2 deep scan took {:.1}s", elapsed.as_secs_f64());

    handle_cli_result(result)
}

/// Shared logic for handling CLI results and parsing scan output.
fn handle_cli_result(result: Result<super::CliResult, String>) -> ScanResult {
    match result {
        Ok(cli_result) => {
            println!(
                "[engine] scan output (first 500 chars): {}",
                &cli_result.stdout[..cli_result.stdout.len().min(500)]
            );
            if !cli_result.success {
                return ScanResult {
                    success: false,
                    tasks_found: vec![],
                    error: Some(format!(
                        "Claude CLI exited with code {:?}: {}",
                        cli_result.exit_code, cli_result.stderr
                    )),
                    tokens_used: 0,
                };
            }

            match parse_scan_output(&cli_result.stdout) {
                Ok(tasks) => ScanResult {
                    success: true,
                    tasks_found: tasks,
                    error: None,
                    tokens_used: 0,
                },
                Err(e) => ScanResult {
                    success: false,
                    tasks_found: vec![],
                    error: Some(format!("Failed to parse scan output: {}", e)),
                    tokens_used: 0,
                },
            }
        }
        Err(e) => ScanResult {
            success: false,
            tasks_found: vec![],
            error: Some(e),
            tokens_used: 0,
        },
    }
}

/// Parse Claude's scan output into structured tasks.
/// Handles both clean JSON output and JSON embedded in text.
fn parse_scan_output(output: &str) -> Result<Vec<ScannedTask>, String> {
    let trimmed = output.trim();

    // First: try parsing the Claude --output-format json wrapper.
    // Claude wraps output as: {"result": "...escaped json string...", "is_error": false}
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result_str) = wrapper.get("result").and_then(|v| v.as_str()) {
            if let Ok(tasks) = serde_json::from_str::<Vec<ScannedTask>>(result_str) {
                return Ok(validate_tasks(tasks));
            }
            // The result field might contain JSON embedded in text
            if let Some(tasks) = extract_json_array(result_str) {
                return Ok(validate_tasks(tasks));
            }
        }
    }

    // Second: try parsing as a direct JSON array
    if let Ok(tasks) = serde_json::from_str::<Vec<ScannedTask>>(trimmed) {
        return Ok(validate_tasks(tasks));
    }

    // Third: try to extract a JSON array from within text
    if let Some(tasks) = extract_json_array(trimmed) {
        return Ok(validate_tasks(tasks));
    }

    Err(format!(
        "Could not find valid JSON task array in output (first 200 chars): {}",
        &trimmed[..trimmed.len().min(200)]
    ))
}

/// Extract the raw JSON array substring from text that may contain surrounding prose.
/// Returns the raw JSON string (including brackets).
pub fn extract_json_array_raw(text: &str) -> Option<String> {
    let start = text.find('[')?;
    let mut depth = 0;
    let mut end = None;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, ch) in text[start..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }

        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }

        if ch == '"' {
            in_string = !in_string;
            continue;
        }

        if in_string {
            continue;
        }

        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(start + i + 1);
                    break;
                }
            }
            _ => {}
        }
    }

    let end = end?;
    Some(text[start..end].to_string())
}

/// Extract a JSON array from text that may contain surrounding prose.
/// String-literal-aware: skips brackets inside JSON string values.
fn extract_json_array(text: &str) -> Option<Vec<ScannedTask>> {
    let start = text.find('[')?;
    let mut depth = 0;
    let mut end = None;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, ch) in text[start..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }

        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }

        if ch == '"' {
            in_string = !in_string;
            continue;
        }

        if in_string {
            continue;
        }

        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(start + i + 1);
                    break;
                }
            }
            _ => {}
        }
    }

    let end = end?;
    let json_str = &text[start..end];
    serde_json::from_str::<Vec<ScannedTask>>(json_str).ok()
}

/// Valid task categories (matches the prompt's category enum).
const VALID_CATEGORIES: &[&str] = &[
    "feature",
    "tech_debt",
    "tests",
    "docs",
    "security",
    "performance",
    "dx",
    "observability",
    "general",
];

/// Validate and clean up scanned tasks.
fn validate_tasks(tasks: Vec<ScannedTask>) -> Vec<ScannedTask> {
    tasks
        .into_iter()
        .filter(|t| {
            !t.title.is_empty()
                && !t.description.is_empty()
                && VALID_CATEGORIES.contains(&t.category.as_str())
                && ["low", "medium", "high"].contains(&t.estimated_effort.as_str())
                && (1..=5).contains(&t.priority)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_direct_json() {
        let input = r#"[{"title":"Add tests for auth module","description":"The auth module has no test coverage","category":"tests","estimated_effort":"medium","files_involved":["src/auth.rs"],"priority":2}]"#;
        let result = parse_scan_output(input).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Add tests for auth module");
    }

    #[test]
    fn test_parse_wrapped_json() {
        let input = r#"{"result":"[{\"title\":\"Fix XSS\",\"description\":\"Unsafe innerHTML usage\",\"category\":\"security\",\"estimated_effort\":\"low\",\"files_involved\":[\"src/ui.tsx\"],\"priority\":1}]","is_error":false}"#;
        let result = parse_scan_output(input).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].category, "security");
    }

    #[test]
    fn test_parse_json_in_prose() {
        let input = "Here are the issues I found:\n\n[{\"title\":\"Missing docs\",\"description\":\"No README\",\"category\":\"docs\",\"estimated_effort\":\"low\",\"files_involved\":[],\"priority\":4}]\n\nLet me know if you need more detail.";
        let result = parse_scan_output(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_invalid_category_filtered() {
        let input = r#"[{"title":"Test","description":"Desc","category":"invalid","estimated_effort":"low","files_involved":[],"priority":1}]"#;
        let result = parse_scan_output(input).unwrap();
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_feature_category_accepted() {
        let input = r#"[{"title":"Add dark mode","description":"Users want dark mode","category":"feature","estimated_effort":"medium","files_involved":["src/theme.rs"],"priority":3}]"#;
        let result = parse_scan_output(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_performance_category_accepted() {
        let input = r#"[{"title":"Optimize query","description":"N+1 query issue","category":"performance","estimated_effort":"high","files_involved":["src/db.rs"],"priority":2}]"#;
        let result = parse_scan_output(input).unwrap();
        assert_eq!(result.len(), 1);
    }
}
