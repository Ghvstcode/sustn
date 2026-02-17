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
    createdAt: string;
    updatedAt: string;
}
