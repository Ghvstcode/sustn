use chrono::{Datelike, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Mirrors Claude Code's ~/.claude/stats-cache.json structure.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsCache {
    #[allow(dead_code)]
    pub version: Option<i32>,
    pub daily_activity: Option<Vec<DailyActivity>>,
    pub daily_model_tokens: Option<Vec<DailyModelTokens>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    pub date: String,
    pub message_count: Option<i64>,
    pub session_count: Option<i64>,
    pub tool_call_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyModelTokens {
    pub date: String,
    pub tokens_by_model: HashMap<String, i64>,
}

/// Budget status returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub weekly_token_budget: i64,
    pub max_usage_percent: i32,
    pub reserve_percent: i32,
    pub tokens_used_today: i64,
    pub tokens_used_this_week: i64,
    pub tokens_available_for_sustn: i64,
    pub budget_exhausted: bool,
    pub source: String,
}

/// Configuration for budget calculations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetConfig {
    pub weekly_token_budget: i64,
    pub max_usage_percent: i32,
    pub reserve_percent: i32,
    pub billing_mode: String,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            weekly_token_budget: 700_000,
            max_usage_percent: 80,
            reserve_percent: 10,
            billing_mode: "subscription".to_string(),
        }
    }
}

/// Find the Claude data directory by looking for stats-cache.json.
/// Checks XDG (~/.config/claude), legacy (~/.claude), and platform config dir.
pub fn find_claude_data_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    let candidates = [
        // XDG location (Claude Code v1.0.30+)
        home.join(".config").join("claude"),
        // Legacy location
        home.join(".claude"),
        // Platform config dir (e.g. ~/Library/Application Support/claude on macOS)
        dirs::config_dir().map(|d| d.join("claude")).unwrap_or_default(),
    ];

    for dir in &candidates {
        if dir.join("stats-cache.json").exists() {
            return Some(dir.clone());
        }
    }

    None
}

/// Read and parse stats-cache.json from the Claude data directory.
pub fn read_stats_cache() -> Result<StatsCache, String> {
    let claude_dir =
        find_claude_data_dir().ok_or_else(|| "Claude data directory not found".to_string())?;

    let stats_path = claude_dir.join("stats-cache.json");
    if !stats_path.exists() {
        return Err("stats-cache.json not found".to_string());
    }

    let data = std::fs::read_to_string(&stats_path)
        .map_err(|e| format!("Failed to read stats-cache.json: {}", e))?;

    serde_json::from_str::<StatsCache>(&data)
        .map_err(|e| format!("Failed to parse stats-cache.json: {}", e))
}

/// Get total tokens for a specific date from stats-cache.
fn tokens_for_date(stats: &StatsCache, date: &str) -> i64 {
    stats
        .daily_model_tokens
        .as_ref()
        .and_then(|entries| {
            entries
                .iter()
                .find(|e| e.date == date)
                .map(|e| e.tokens_by_model.values().sum())
        })
        .unwrap_or(0)
}

/// Get today's token usage from stats-cache.json.
pub fn get_today_usage() -> Result<(i64, String), String> {
    let stats = read_stats_cache()?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let tokens = tokens_for_date(&stats, &today);
    Ok((tokens, "stats-cache".to_string()))
}

/// Get the last 7 days of token usage from stats-cache.json.
pub fn get_weekly_usage() -> Result<(i64, String), String> {
    let stats = read_stats_cache()?;
    let now = Local::now().date_naive();
    let mut total: i64 = 0;

    for i in 0..7 {
        if let Some(date) = now.checked_sub_signed(chrono::Duration::days(i)) {
            let date_str = date.format("%Y-%m-%d").to_string();
            total += tokens_for_date(&stats, &date_str);
        }
    }

    Ok((total, "stats-cache".to_string()))
}

/// Calculate the full budget status given a budget config.
pub fn calculate_budget_status(config: &BudgetConfig) -> BudgetStatus {
    let (tokens_today, _) = get_today_usage().unwrap_or((0, "unavailable".to_string()));
    let (tokens_week, source) = get_weekly_usage().unwrap_or((0, "unavailable".to_string()));

    let max_for_sustn =
        config.weekly_token_budget * (config.max_usage_percent as i64) / 100;
    let reserve = config.weekly_token_budget * (config.reserve_percent as i64) / 100;
    let available = (max_for_sustn - tokens_week - reserve).max(0);

    BudgetStatus {
        weekly_token_budget: config.weekly_token_budget,
        max_usage_percent: config.max_usage_percent,
        reserve_percent: config.reserve_percent,
        tokens_used_today: tokens_today,
        tokens_used_this_week: tokens_week,
        tokens_available_for_sustn: available,
        budget_exhausted: available <= 0,
        source,
    }
}

/// Estimate token cost for a task based on effort level.
pub fn estimated_task_tokens(effort: Option<&str>) -> i64 {
    match effort {
        Some("low") => 30_000,
        Some("medium") => 100_000,
        Some("high") => 300_000,
        _ => 100_000, // default to medium
    }
}

/// Get the start of the current week (Monday) as a date string.
pub fn current_week_start() -> String {
    let now = Local::now().date_naive();
    let weekday = now.weekday().num_days_from_monday();
    let monday = now - chrono::Duration::days(weekday as i64);
    monday.format("%Y-%m-%d").to_string()
}
