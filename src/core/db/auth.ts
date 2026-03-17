import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { config } from "@core/config";

interface AuthRow {
    id: string;
    github_id: number;
    github_username: string;
    github_avatar_url: string | null;
    github_email: string | null;
    github_access_token: string | null;
    created_at: string;
    updated_at: string;
}

export interface AuthRecord {
    id: string;
    githubId: number;
    username: string;
    avatarUrl: string | undefined;
    email: string | undefined;
    accessToken: string;
}

async function getDb() {
    return await Database.load(config.dbUrl);
}

/**
 * Migrate a plaintext token from SQLite to the OS keychain.
 * Called lazily on first read when a legacy row still has a token.
 */
async function migrateTokenToKeychain(
    db: Database,
    row: AuthRow,
): Promise<void> {
    if (!row.github_access_token) return;

    await invoke("keychain_set_token", { token: row.github_access_token });
    await db.execute(
        "UPDATE auth SET github_access_token = NULL WHERE id = $1",
        [row.id],
    );
}

async function rowToRecord(
    db: Database,
    row: AuthRow,
): Promise<AuthRecord | undefined> {
    // Migrate legacy plaintext token if present
    if (row.github_access_token) {
        await migrateTokenToKeychain(db, row);
    }

    const token = await invoke<string | null>("keychain_get_token");
    if (!token) return undefined;

    return {
        id: row.id,
        githubId: row.github_id,
        username: row.github_username,
        avatarUrl: row.github_avatar_url ?? undefined,
        email: row.github_email ?? undefined,
        accessToken: token,
    };
}

export async function getAuth(): Promise<AuthRecord | undefined> {
    const db = await getDb();
    const rows = await db.select<AuthRow[]>("SELECT * FROM auth LIMIT 1");
    if (rows.length === 0) return undefined;
    return await rowToRecord(db, rows[0]);
}

export async function saveAuth(params: {
    githubId: number;
    username: string;
    avatarUrl: string | undefined;
    email: string | undefined;
    accessToken: string;
}): Promise<void> {
    const db = await getDb();
    const id = await invoke<string>("generate_auth_id");

    // Delete any existing auth record (single-user app)
    await db.execute("DELETE FROM auth");
    await invoke("keychain_delete_token");

    // Store token in OS keychain, not in SQLite
    await invoke("keychain_set_token", { token: params.accessToken });

    await db.execute(
        `INSERT INTO auth (id, github_id, github_username, github_avatar_url, github_email, github_access_token)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [
            id,
            params.githubId,
            params.username,
            params.avatarUrl ?? null,
            params.email ?? null,
        ],
    );
}

export async function clearAuth(): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM auth");
    await invoke("keychain_delete_token");
}

export async function validateToken(): Promise<boolean> {
    const auth = await getAuth();
    if (!auth) return false;

    try {
        const response = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                "User-Agent": "SUSTN-Desktop/0.1.0",
            },
        });
        return response.ok;
    } catch {
        // Network error — don't invalidate, just report as unknown
        return true;
    }
}
