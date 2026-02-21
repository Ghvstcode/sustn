import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, metricEvents } from "../db/schema.js";
import { fetchGitHubUser } from "../lib/github.js";

const metrics = new Hono();

async function resolveUserId(token: string): Promise<number | null> {
    try {
        const ghUser = await fetchGitHubUser(token);
        const rows = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.githubId, ghUser.id))
            .limit(1);
        return rows.length > 0 ? rows[0].id : null;
    } catch {
        return null;
    }
}

interface MetricEvent {
    eventType: string;
    eventData?: Record<string, unknown>;
    clientTimestamp: string;
}

metrics.post("/metrics/events", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await resolveUserId(token);
    if (!userId) {
        return c.json({ error: "Unauthorized" }, 401);
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
            eventData: e.eventData ?? null,
            clientTimestamp: new Date(e.clientTimestamp),
        })),
    );

    return c.json({ accepted: events.length });
});

export { metrics };
