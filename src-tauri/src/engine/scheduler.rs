use chrono::{Local, NaiveTime, Timelike};
use serde::{Deserialize, Serialize};

/// Schedule configuration for a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleConfig {
    pub enabled: bool,
    pub schedule_mode: ScheduleMode,
    pub window_start: Option<String>,  // "HH:MM"
    pub window_end: Option<String>,    // "HH:MM"
    pub scan_interval_minutes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleMode {
    Always,
    Scheduled,
    Manual,
}

impl Default for ScheduleConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            schedule_mode: ScheduleMode::Always,
            window_start: None,
            window_end: None,
            scan_interval_minutes: 360,
        }
    }
}

/// Check if work is allowed right now given the schedule config.
pub fn can_work_now(config: &ScheduleConfig) -> CanWorkResult {
    if !config.enabled {
        return CanWorkResult {
            allowed: false,
            reason: "Agent is paused for this project".to_string(),
        };
    }

    match config.schedule_mode {
        ScheduleMode::Manual => CanWorkResult {
            allowed: false,
            reason: "Manual mode — waiting for explicit trigger".to_string(),
        },
        ScheduleMode::Always => CanWorkResult {
            allowed: true,
            reason: "Always-on mode".to_string(),
        },
        ScheduleMode::Scheduled => {
            match (&config.window_start, &config.window_end) {
                (Some(start), Some(end)) => {
                    let in_window = is_in_time_window(start, end);
                    if in_window {
                        CanWorkResult {
                            allowed: true,
                            reason: format!("Within scheduled window ({}-{})", start, end),
                        }
                    } else {
                        CanWorkResult {
                            allowed: false,
                            reason: format!("Outside scheduled window ({}-{})", start, end),
                        }
                    }
                }
                _ => CanWorkResult {
                    allowed: false,
                    reason: "Scheduled mode but no time window configured".to_string(),
                },
            }
        }
    }
}

/// Check if scanning is allowed right now.
/// Scanning is allowed more freely than working — even in manual mode.
pub fn can_scan_now(config: &ScheduleConfig) -> CanWorkResult {
    if !config.enabled {
        return CanWorkResult {
            allowed: false,
            reason: "Agent is paused for this project".to_string(),
        };
    }

    // Scanning is allowed in all modes except when paused
    CanWorkResult {
        allowed: true,
        reason: "Scanning is allowed in all active modes".to_string(),
    }
}

/// Check if enough time has passed since the last scan.
pub fn scan_due(last_scan_at: Option<&str>, interval_minutes: i32) -> bool {
    match last_scan_at {
        None => true, // Never scanned — due immediately
        Some(last) => {
            if let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(last) {
                let elapsed = Local::now().signed_duration_since(last_time);
                elapsed.num_minutes() >= interval_minutes as i64
            } else {
                true // Can't parse — treat as due
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CanWorkResult {
    pub allowed: bool,
    pub reason: String,
}

/// Check if the current time falls within a time window.
/// Handles overnight windows like 22:00 - 06:00.
fn is_in_time_window(start_str: &str, end_str: &str) -> bool {
    let now = Local::now();
    let current = NaiveTime::from_hms_opt(now.hour(), now.minute(), 0)
        .unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());

    let start = parse_time(start_str).unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    let end = parse_time(end_str).unwrap_or_else(|| NaiveTime::from_hms_opt(23, 59, 0).unwrap());

    if start <= end {
        // Normal window (e.g., 09:00 - 17:00)
        current >= start && current <= end
    } else {
        // Overnight window (e.g., 22:00 - 06:00)
        current >= start || current <= end
    }
}

fn parse_time(s: &str) -> Option<NaiveTime> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 2 {
        let h = parts[0].parse::<u32>().ok()?;
        let m = parts[1].parse::<u32>().ok()?;
        NaiveTime::from_hms_opt(h, m, 0)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_always_mode_allows_work() {
        let config = ScheduleConfig::default();
        assert!(can_work_now(&config).allowed);
    }

    #[test]
    fn test_manual_mode_blocks_work() {
        let config = ScheduleConfig {
            schedule_mode: ScheduleMode::Manual,
            ..Default::default()
        };
        assert!(!can_work_now(&config).allowed);
    }

    #[test]
    fn test_paused_blocks_everything() {
        let config = ScheduleConfig {
            enabled: false,
            ..Default::default()
        };
        assert!(!can_work_now(&config).allowed);
        assert!(!can_scan_now(&config).allowed);
    }

    #[test]
    fn test_scan_allowed_in_manual_mode() {
        let config = ScheduleConfig {
            schedule_mode: ScheduleMode::Manual,
            ..Default::default()
        };
        assert!(can_scan_now(&config).allowed);
    }

    #[test]
    fn test_scan_due_when_never_scanned() {
        assert!(scan_due(None, 360));
    }
}
