export type TaskCategory =
    | "tech_debt"
    | "tests"
    | "docs"
    | "security"
    | "general";

export type TaskState =
    | "pending"
    | "in_progress"
    | "review"
    | "done"
    | "dismissed";

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
