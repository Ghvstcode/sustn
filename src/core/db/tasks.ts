import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { config } from "@core/config";
import type {
    Task,
    TaskCategory,
    TaskState,
    TaskEvent,
} from "@core/types/task";

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
    lines_added: number | null;
    lines_removed: number | null;
    created_at: string;
    updated_at: string;
}

interface TaskEventRow {
    id: string;
    task_id: string;
    event_type: string;
    field: string | null;
    old_value: string | null;
    new_value: string | null;
    comment: string | null;
    created_at: string;
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
        linesAdded: row.lines_added ?? undefined,
        linesRemoved: row.lines_removed ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToTaskEvent(row: TaskEventRow): TaskEvent {
    return {
        id: row.id,
        taskId: row.task_id,
        eventType: row.event_type,
        field: row.field ?? undefined,
        oldValue: row.old_value ?? undefined,
        newValue: row.new_value ?? undefined,
        comment: row.comment ?? undefined,
        createdAt: row.created_at,
    };
}

async function generateEventId(): Promise<string> {
    return await invoke<string>("generate_task_id");
}

async function recordEvent(
    db: Awaited<ReturnType<typeof getDb>>,
    taskId: string,
    eventType: string,
    field?: string,
    oldValue?: string,
    newValue?: string,
    comment?: string,
): Promise<void> {
    const id = await generateEventId();
    await db.execute(
        "INSERT INTO task_events (id, task_id, event_type, field, old_value, new_value, comment) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
            id,
            taskId,
            eventType,
            field ?? null,
            oldValue ?? null,
            newValue ?? null,
            comment ?? null,
        ],
    );
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

    await recordEvent(db, id, "created");

    const rows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE id = $1",
        [id],
    );

    return rowToTask(rows[0]);
}

// Field-to-event-type mapping for tracked fields
const fieldEventTypes: Record<string, string> = {
    title: "title_change",
    description: "description_change",
    state: "state_change",
    notes: "notes_change",
    prUrl: "pr_url_change",
    category: "category_change",
};

// Field name to DB column mapping
const fieldToColumn: Record<string, string> = {
    title: "title",
    description: "description",
    state: "state",
    notes: "notes",
    prUrl: "pr_url",
    category: "category",
};

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

    // Read current values for event recording
    const currentRows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE id = $1",
        [id],
    );
    const current = currentRows[0];

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

    // Record events for tracked field changes
    if (current) {
        for (const [field, eventType] of Object.entries(fieldEventTypes)) {
            const newVal = fields[field as keyof typeof fields];
            if (newVal === undefined) continue;

            const col = fieldToColumn[field];
            const oldVal = current[col as keyof TaskRow];
            const oldStr = oldVal != null ? String(oldVal) : undefined;
            const newStr = String(newVal);

            if (oldStr !== newStr) {
                await recordEvent(db, id, eventType, field, oldStr, newStr);
            }
        }
    }

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

export async function addComment(
    taskId: string,
    comment: string,
): Promise<TaskEvent> {
    const db = await getDb();
    const id = await generateEventId();
    await db.execute(
        "INSERT INTO task_events (id, task_id, event_type, comment) VALUES ($1, $2, $3, $4)",
        [id, taskId, "comment", comment],
    );
    const rows = await db.select<TaskEventRow[]>(
        "SELECT * FROM task_events WHERE id = $1",
        [id],
    );
    return rowToTaskEvent(rows[0]);
}

export async function listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    const db = await getDb();
    const rows = await db.select<TaskEventRow[]>(
        "SELECT * FROM task_events WHERE task_id = $1 ORDER BY created_at DESC",
        [taskId],
    );
    return rows.map(rowToTaskEvent);
}
