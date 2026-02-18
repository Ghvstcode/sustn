use serde::{Deserialize, Serialize};

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

const SCAN_PROMPT: &str = r#"You are a codebase analyzer. Scan this repository and identify actionable improvements.

For each issue found, output ONLY a JSON array (no markdown, no explanation, just the raw JSON):

[{
  "title": "Short descriptive title",
  "description": "What the issue is and why it matters. Be specific.",
  "category": "tech_debt" | "tests" | "docs" | "security" | "general",
  "estimated_effort": "low" | "medium" | "high",
  "files_involved": ["path/to/file1.ts", "path/to/file2.ts"],
  "priority": 1
}]

Priority scale: 1 (critical) to 5 (nice-to-have).

Focus on:
- Missing or inadequate tests
- Security vulnerabilities or unsafe patterns
- Documentation gaps for public APIs
- Code duplication and technical debt
- Error handling gaps
- Performance issues

Rules:
- Only flag CONCRETE issues you can see in the code, not speculative improvements.
- Each task should be independently implementable.
- Keep titles under 80 characters.
- Limit to the 15 most important issues.
- Output ONLY the JSON array, nothing else."#;

/// Scan a repository and return discovered tasks.
pub async fn scan_repository(repo_path: &str) -> ScanResult {
    let timeout_secs = 300; // 5 minutes for scanning

    let result = invoke_claude_cli(repo_path, SCAN_PROMPT, timeout_secs).await;

    match result {
        Ok(cli_result) => {
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
                    tokens_used: 0, // We'll get actual tokens from stats-cache diff
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

/// Extract a JSON array from text that may contain surrounding prose.
fn extract_json_array(text: &str) -> Option<Vec<ScannedTask>> {
    // Find the first '[' and its matching ']'
    let start = text.find('[')?;
    let mut depth = 0;
    let mut end = None;

    for (i, ch) in text[start..].char_indices() {
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

/// Validate and clean up scanned tasks.
fn validate_tasks(tasks: Vec<ScannedTask>) -> Vec<ScannedTask> {
    tasks
        .into_iter()
        .filter(|t| {
            !t.title.is_empty()
                && !t.description.is_empty()
                && ["tech_debt", "tests", "docs", "security", "general"]
                    .contains(&t.category.as_str())
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
}
