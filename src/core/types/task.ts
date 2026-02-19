export type TaskCategory =
    | "tech_debt"
    | "tests"
    | "docs"
    | "security"
    | "feature"
    | "performance"
    | "dx"
    | "observability"
    | "general";

export type TaskState =
    | "pending"
    | "in_progress"
    | "review"
    | "done"
    | "dismissed"
    | "failed";

export type TaskSource = "manual" | "scan";
export type EstimatedEffort = "low" | "medium" | "high";

export interface Task {
    id: string;
    repositoryId: string;
    title: string;
    description: string | undefined;
    category: TaskCategory;
    state: TaskState;
    sortOrder: number;
    notes: string | undefined;
    prUrl: string | undefined;
    linesAdded: number | undefined;
    linesRemoved: number | undefined;
    source: TaskSource;
    estimatedEffort: EstimatedEffort | undefined;
    filesInvolved: string[] | undefined;
    baseBranch: string | undefined;
    branchName: string | undefined;
    commitSha: string | undefined;
    tokensUsed: number;
    retryCount: number;
    lastError: string | undefined;
    startedAt: string | undefined;
    completedAt: string | undefined;
    createdAt: string;
    updatedAt: string;
}

export interface TaskEvent {
    id: string;
    taskId: string;
    eventType: string;
    field: string | undefined;
    oldValue: string | undefined;
    newValue: string | undefined;
    comment: string | undefined;
    createdAt: string;
}
