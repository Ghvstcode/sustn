import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { config } from "@core/config";

interface RepositoryRow {
    id: string;
    path: string;
    name: string;
    created_at: string;
}

export interface Repository {
    id: string;
    path: string;
    name: string;
    createdAt: string;
}

async function getDb() {
    return await Database.load(config.dbUrl);
}

function rowToRepository(row: RepositoryRow): Repository {
    return {
        id: row.id,
        path: row.path,
        name: row.name,
        createdAt: row.created_at,
    };
}

export async function listRepositories(): Promise<Repository[]> {
    const db = await getDb();
    const rows = await db.select<RepositoryRow[]>(
        "SELECT * FROM repositories ORDER BY created_at DESC",
    );
    return rows.map(rowToRepository);
}

export async function addRepository(
    path: string,
    name: string,
): Promise<Repository> {
    const db = await getDb();
    const id = await invoke<string>("generate_repo_id");

    await db.execute(
        "INSERT INTO repositories (id, path, name) VALUES ($1, $2, $3)",
        [id, path, name],
    );

    const rows = await db.select<RepositoryRow[]>(
        "SELECT * FROM repositories WHERE id = $1",
        [id],
    );

    return rowToRepository(rows[0]);
}
