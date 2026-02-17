import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { config } from "@core/config";
import type { Task, TaskCategory, TaskState } from "@core/types/task";

interface TaskRow {
    id: string;
    repository_id: string;
    title: string;
    description: string | null;
    category: string;
    state: string;
    sort_order: number;
    notes: string | null;
    pr_url: string | null;
    created_at: string;
    updated_at: string;
}

async function getDb() {
    return await Database.load(config.dbUrl);
}

function rowToTask(row: TaskRow): Task {
    return {
        id: row.id,
        repositoryId: row.repository_id,
        title: row.title,
        description: row.description ?? undefined,
        category: row.category as TaskCategory,
        state: row.state as TaskState,
        sortOrder: row.sort_order,
        notes: row.notes ?? undefined,
        prUrl: row.pr_url ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function listTasks(repositoryId: string): Promise<Task[]> {
    const db = await getDb();
    const rows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE repository_id = $1 ORDER BY sort_order ASC",
        [repositoryId],
    );
    return rows.map(rowToTask);
}

export async function getTask(id: string): Promise<Task | undefined> {
    const db = await getDb();
    const rows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE id = $1",
        [id],
    );
    return rows[0] ? rowToTask(rows[0]) : undefined;
}

export async function createTask(task: {
    repositoryId: string;
    title: string;
    description?: string;
    category: TaskCategory;
    sortOrder: number;
}): Promise<Task> {
    const db = await getDb();
    const id = await invoke<string>("generate_task_id");

    await db.execute(
        "INSERT INTO tasks (id, repository_id, title, description, category, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
        [
            id,
            task.repositoryId,
            task.title,
            task.description ?? null,
            task.category,
            task.sortOrder,
        ],
    );

    const rows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE id = $1",
        [id],
    );

    return rowToTask(rows[0]);
}

export async function updateTask(
    id: string,
    fields: Partial<
        Pick<
            Task,
            | "title"
            | "description"
            | "state"
            | "sortOrder"
            | "notes"
            | "prUrl"
            | "category"
        >
    >,
): Promise<Task> {
    const db = await getDb();

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (fields.title !== undefined) {
        setClauses.push(`title = $${paramIndex++}`);
        values.push(fields.title);
    }
    if (fields.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(fields.description);
    }
    if (fields.state !== undefined) {
        setClauses.push(`state = $${paramIndex++}`);
        values.push(fields.state);
    }
    if (fields.sortOrder !== undefined) {
        setClauses.push(`sort_order = $${paramIndex++}`);
        values.push(fields.sortOrder);
    }
    if (fields.notes !== undefined) {
        setClauses.push(`notes = $${paramIndex++}`);
        values.push(fields.notes);
    }
    if (fields.prUrl !== undefined) {
        setClauses.push(`pr_url = $${paramIndex++}`);
        values.push(fields.prUrl);
    }
    if (fields.category !== undefined) {
        setClauses.push(`category = $${paramIndex++}`);
        values.push(fields.category);
    }

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

    await db.execute(
        `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
        [...values, id],
    );

    const rows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE id = $1",
        [id],
    );

    return rowToTask(rows[0]);
}

export async function deleteTask(id: string): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
}

export async function reorderTask(
    id: string,
    newSortOrder: number,
): Promise<void> {
    const db = await getDb();
    await db.execute(
        "UPDATE tasks SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [newSortOrder, id],
    );
}
