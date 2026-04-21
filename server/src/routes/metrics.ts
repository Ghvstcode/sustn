import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Bindings } from "../lib/config.js";
import { createDb } from "../db/index.js";
import { users, metricEvents } from "../db/schema.js";
import { fetchGitHubUser } from "../lib/github.js";
import { rateLimitByToken } from "../lib/rate-limit.js";

const metrics = new Hono<{ Bindings: Bindings }>();

const ALLOWED_EVENT_TYPES = new Set([
    "session_start",
    "session_end",
    "project_added",
    "settings_changed",
    "task_created",
    "agent_run_started",
    "agent_run_completed",
]);

const MAX_EVENT_DATA_SIZE = 10_000; // 10KB per event's eventData
const MAX_BATCH_SIZE = 100_000; // 100KB total request body

interface MetricEvent {
    eventType: string;
    eventData?: Record<string, unknown>;
    clientTimestamp: string;
}

// 5 requests per minute per user token
const metricsRateLimit = rateLimitByToken(5, 60_000);

metrics.post("/metrics/events", metricsRateLimit, async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Check Content-Length before parsing
    const contentLength = parseInt(c.req.header("Content-Length") ?? "0", 10);
    if (contentLength > MAX_BATCH_SIZE) {
        return c.json({ error: "Request body too large" }, 413);
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

    const body = await c.req.json<{ events: MetricEvent[] }>();
    if (!Array.isArray(body.events) || body.events.length === 0) {
        return c.json({ error: "No events provided" }, 400);
    }

    // Cap batch size
    const events = body.events.slice(0, 100);

    // Validate events
    const validEvents: MetricEvent[] = [];
    for (const e of events) {
        if (!ALLOWED_EVENT_TYPES.has(e.eventType)) {
            continue; // silently skip unknown event types
        }

        if (e.eventData) {
            const serialized = JSON.stringify(e.eventData);
            if (serialized.length > MAX_EVENT_DATA_SIZE) {
                continue; // skip oversized event data
            }
        }

        if (!e.clientTimestamp || isNaN(Date.parse(e.clientTimestamp))) {
            continue; // skip events with invalid timestamps
        }

        validEvents.push(e);
    }

    if (validEvents.length === 0) {
        return c.json({ accepted: 0 });
    }

    await db.insert(metricEvents).values(
        validEvents.map((e) => ({
            userId,
            eventType: e.eventType,
            eventData: e.eventData ? JSON.stringify(e.eventData) : null,
            clientTimestamp: new Date(e.clientTimestamp).toISOString(),
        })),
    );

    return c.json({ accepted: validEvents.length });
});

export { metrics };
