import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, feedbackEntries } from "../db/schema.js";
import { fetchGitHubUser } from "../lib/github.js";

const feedback = new Hono();

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

interface FeedbackImage {
    name: string;
    data: string;
}

interface FeedbackBody {
    message: string;
    images?: FeedbackImage[];
}

feedback.post("/feedback", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    const userId = await resolveUserId(token);
    if (!userId) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json<FeedbackBody>();
    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
        return c.json({ error: "Message is required" }, 400);
    }

    // Cap images to 5 and message length to 10,000 chars
    const message = body.message.trim().slice(0, 10_000);
    const images = Array.isArray(body.images) ? body.images.slice(0, 5) : null;

    await db.insert(feedbackEntries).values({
        userId,
        message,
        images,
    });

    return c.json({ success: true });
});

export { feedback };
