use serde::Serialize;

/// A project candidate with its computed score.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScore {
    pub repository_id: String,
    pub repo_path: String,
    pub score: f64,
    pub pending_task_count: i32,
    pub reason: String,
}

/// A task candidate with its computed score.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskScore {
    pub task_id: String,
    pub score: f64,
    pub reason: String,
}

/// Inputs for scoring a project.
pub struct ProjectInput {
    pub repository_id: String,
    pub repo_path: String,
    pub priority: i32,               // 1-5 user-set priority
    pub hours_since_last_work: f64,  // staleness
    pub pending_task_count: i32,
    pub highest_task_priority: i32,  // 1=critical, 5=nice-to-have
    pub tasks_completed_today: i32,
}

/// Inputs for scoring a task within a project.
pub struct TaskInput {
    pub task_id: String,
    pub priority: i32,          // 1-5 from scan
    pub category: String,
    pub days_since_created: f64,
    pub estimated_effort: String,
}

/// Category weights — security and tests get more attention.
fn category_weight(category: &str) -> f64 {
    match category {
        "security" => 5.0,
        "tests" => 3.0,
        "tech_debt" => 2.0,
        "general" => 1.5,
        "docs" => 1.0,
        _ => 1.0,
    }
}

/// Score a project for scheduling priority.
/// Higher score = should be worked on sooner.
pub fn score_project(input: &ProjectInput) -> ProjectScore {
    if input.pending_task_count == 0 {
        return ProjectScore {
            repository_id: input.repository_id.clone(),
            repo_path: input.repo_path.clone(),
            score: 0.0,
            pending_task_count: 0,
            reason: "No pending tasks".to_string(),
        };
    }

    let base = input.priority as f64 * 2.0;
    let staleness = (input.hours_since_last_work * 0.5).min(10.0);
    let urgency = (6 - input.highest_task_priority.clamp(1, 5)) as f64;
    let cooldown = input.tasks_completed_today as f64 * -2.0;

    let score = base + staleness + urgency + cooldown;

    ProjectScore {
        repository_id: input.repository_id.clone(),
        repo_path: input.repo_path.clone(),
        score,
        pending_task_count: input.pending_task_count,
        reason: format!(
            "base={:.1} staleness={:.1} urgency={:.1} cooldown={:.1}",
            base, staleness, urgency, cooldown
        ),
    }
}

/// Score a task within a project.
/// Higher score = should be picked first.
pub fn score_task(input: &TaskInput) -> TaskScore {
    let priority_score = (6 - input.priority.clamp(1, 5)) as f64;
    let category_score = category_weight(&input.category);
    let age_bonus = (input.days_since_created * 0.1).min(3.0);

    // Prefer lower-effort tasks when budget is limited
    let effort_factor = match input.estimated_effort.as_str() {
        "low" => 1.5,
        "medium" => 1.0,
        "high" => 0.5,
        _ => 1.0,
    };

    let score = (priority_score + category_score + age_bonus) * effort_factor;

    TaskScore {
        task_id: input.task_id.clone(),
        score,
        reason: format!(
            "priority={:.1} category={:.1} age={:.1} effort={:.1}",
            priority_score, category_score, age_bonus, effort_factor
        ),
    }
}

/// Select the best project to work on from a list of candidates.
pub fn select_best_project(inputs: &[ProjectInput]) -> Option<ProjectScore> {
    inputs
        .iter()
        .map(score_project)
        .filter(|s| s.score > 0.0)
        .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal))
}

/// Select the best task to work on from a list of candidates.
pub fn select_best_task(inputs: &[TaskInput]) -> Option<TaskScore> {
    inputs
        .iter()
        .map(score_task)
        .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal))
}
