import type { Context, Next } from "hono";
import type { Bindings } from "./config.js";

function getWindowStart(windowMs: number): number {
    const now = Date.now();
    return Math.floor(now / windowMs) * windowMs;
}

async function isRateLimited(
    db: D1Database,
    key: string,
    maxRequests: number,
    windowMs: number,
): Promise<boolean> {
    const windowStart = getWindowStart(windowMs);

    // Atomically insert or increment the counter for this key+window,
    // and return the new count. D1 is shared across isolates so this
    // is consistent regardless of which Worker instance handles the request.
    const result = await db
        .prepare(
            `INSERT INTO rate_limits (key, window_start, count)
             VALUES (?, ?, 1)
             ON CONFLICT (key, window_start)
             DO UPDATE SET count = count + 1
             RETURNING count`,
        )
        .bind(key, windowStart)
        .first<{ count: number }>();

    // Clean up old windows (non-blocking, best-effort)
    const cutoff = windowStart - windowMs;
    void db
        .prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
        .bind(cutoff)
        .run();

    return (result?.count ?? 0) > maxRequests;
}

/**
 * Rate limit by client IP address.
 * Uses D1 for state so limits are enforced across Worker isolates.
 */
export function rateLimitByIp(maxRequests: number, windowMs: number) {
    return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
        const ip =
            c.req.header("cf-connecting-ip") ??
            c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown";

        const key = `ip:${ip}`;
        if (await isRateLimited(c.env.DB, key, maxRequests, windowMs)) {
            return c.json({ error: "Too many requests" }, 429);
        }

        await next();
    };
}

/**
 * Rate limit by Bearer token (user-level).
 * Uses D1 for state so limits are enforced across Worker isolates.
 */
export function rateLimitByToken(maxRequests: number, windowMs: number) {
    return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
        const authHeader = c.req.header("Authorization");
        const token = authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : "anonymous";

        const key = `token:${token}`;
        if (await isRateLimited(c.env.DB, key, maxRequests, windowMs)) {
            return c.json({ error: "Too many requests" }, 429);
        }

        await next();
    };
}
