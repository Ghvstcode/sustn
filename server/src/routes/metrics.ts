import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import type { Bindings } from "../lib/config.js";
import { createDb } from "../db/index.js";
import { users, metricEvents } from "../db/schema.js";
import { fetchGitHubUser } from "../lib/github.js";

const KNOWN_EVENT_TYPES = new Set([
    "session_start",
    "session_end",
    "project_added",
    "settings_changed",
    "agent_run_started",
    "agent_run_completed",
    "task_created",
]);

const MAX_EVENT_DATA_BYTES = 10 * 1024; // 10 KB per event
const MAX_TIMESTAMP_DRIFT_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BATCH_SIZE = 100;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB total request body

interface MetricEvent {
    eventType: string;
    eventData?: Record<string, unknown>;
    clientTimestamp: string;
}

interface ValidationError {
    index: number;
    field: string;
    message: string;
}

function validateEvent(
    event: MetricEvent,
    index: number,
    now: number,
): ValidationError | undefined {
    if (typeof event.eventType !== "string" || !event.eventType) {
        return {
            index,
            field: "eventType",
            message: "must be a non-empty string",
        };
    }

    if (!KNOWN_EVENT_TYPES.has(event.eventType)) {
        return {
            index,
            field: "eventType",
            message: `unknown event type "${event.eventType}"`,
        };
    }

    if (event.eventData !== undefined) {
        if (
            typeof event.eventData !== "object" ||
            event.eventData === null ||
            Array.isArray(event.eventData)
        ) {
            return {
                index,
                field: "eventData",
                message: "must be a JSON object",
            };
        }

        const serialized = JSON.stringify(event.eventData);
        if (serialized.length > MAX_EVENT_DATA_BYTES) {
            return {
                index,
                field: "eventData",
                message: `exceeds max size of ${MAX_EVENT_DATA_BYTES} bytes`,
            };
        }
    }

    if (typeof event.clientTimestamp !== "string" || !event.clientTimestamp) {
        return {
            index,
            field: "clientTimestamp",
            message: "must be a non-empty string",
        };
    }

    const ts = new Date(event.clientTimestamp);
    if (isNaN(ts.getTime())) {
        return {
            index,
            field: "clientTimestamp",
            message: "invalid date format",
        };
    }

    const drift = Math.abs(ts.getTime() - now);
    if (drift > MAX_TIMESTAMP_DRIFT_MS) {
        return {
            index,
            field: "clientTimestamp",
            message: "timestamp is too far from server time (max 24h drift)",
        };
    }

    return undefined;
}

const metrics = new Hono<{ Bindings: Bindings }>();

metrics.post(
    "/metrics/events",
    bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) =>
            c.json(
                {
                    error: `Request body exceeds max size of ${MAX_BODY_BYTES} bytes`,
                },
                413,
            ),
    }),
    async (c) => {
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

        const body = await c.req.json<{ events: MetricEvent[] }>();
        if (!Array.isArray(body.events) || body.events.length === 0) {
            return c.json({ error: "No events provided" }, 400);
        }

        // Cap batch size
        const events = body.events.slice(0, MAX_BATCH_SIZE);

        // Validate each event
        const now = Date.now();
        const errors: ValidationError[] = [];
        for (let i = 0; i < events.length; i++) {
            const error = validateEvent(events[i], i, now);
            if (error) {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            return c.json({ error: "Validation failed", details: errors }, 400);
        }

        await db.insert(metricEvents).values(
            events.map((e) => ({
                userId,
                eventType: e.eventType,
                eventData: e.eventData ? JSON.stringify(e.eventData) : null,
                clientTimestamp: new Date(e.clientTimestamp).toISOString(),
            })),
        );

        return c.json({ accepted: events.length });
    },
);

export { metrics };
