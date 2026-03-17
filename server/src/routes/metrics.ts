import { Hono } from "hono";
import { eq, gte, and, sql } from "drizzle-orm";
import type { Bindings } from "../lib/config.js";
import { createDb } from "../db/index.js";
import { users, metricEvents } from "../db/schema.js";
import { fetchGitHubUser } from "../lib/github.js";

const metrics = new Hono<{ Bindings: Bindings }>();

interface MetricEvent {
    eventType: string;
    eventData?: Record<string, unknown>;
    clientTimestamp: string;
}

// Database-backed rate limiter for Cloudflare Workers
// Limits: 100 requests per user per minute
// Uses D1 to persist rate limit state across worker isolates
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 100;

async function checkRateLimit(
    db: ReturnType<typeof createDb>,
    userId: number,
): Promise<boolean> {
    try {
        // Count events from the last minute using SQLite datetime comparison
        // D1/SQLite stores timestamps as ISO strings, so we use datetime('now', '-1 minute')
        const result = await db
            .select({
                count: sql<number>`count(*)`,
            })
            .from(metricEvents)
            .where(
                and(
                    eq(metricEvents.userId, userId),
                    gte(
                        metricEvents.createdAt,
                        sql`datetime('now', '-1 minute')`,
                    ),
                ),
            );

        const count = result[0]?.count ?? 0;

        if (count >= RATE_LIMIT_MAX) {
            return false;
        }

        return true;
    } catch {
        // On error, allow the request (fail open)
        return true;
    }
}

metrics.post("/metrics/events", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDb(c.env.DB);
    const token = authHeader.slice(7);

    // Resolve user from token
    let userId: number | null = null;
    try {
        const ghUser = await fetchGitHubUser(token);
        const rows = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.githubId, ghUser.id))
            .limit(1);
        userId = rows.length > 0 ? rows[0].id : null;
    } catch {
        userId = null;
    }

    if (!userId) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Rate limiting check
    if (!(await checkRateLimit(db, userId))) {
        return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json<{ events: MetricEvent[] }>();
    if (!Array.isArray(body.events) || body.events.length === 0) {
        return c.json({ error: "No events provided" }, 400);
    }

    // Cap batch size
    const events = body.events.slice(0, 100);

    await db.insert(metricEvents).values(
        events.map((e) => ({
            userId,
            eventType: e.eventType,
            eventData: e.eventData ? JSON.stringify(e.eventData) : null,
            clientTimestamp: new Date(e.clientTimestamp).toISOString(),
        })),
    );

    return c.json({ accepted: events.length });
});

export { metrics };
