import type { Context, Next } from "hono";
import type { Bindings } from "./config.js";

interface SlidingWindowEntry {
    timestamps: number[];
}

const store = new Map<string, SlidingWindowEntry>();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;

    const cutoff = now - windowMs;
    for (const [key, entry] of store) {
        entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
        if (entry.timestamps.length === 0) {
            store.delete(key);
        }
    }
}

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    cleanup(windowMs);

    const cutoff = now - windowMs;
    let entry = store.get(key);
    if (!entry) {
        entry = { timestamps: [] };
        store.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= maxRequests) {
        return true;
    }

    entry.timestamps.push(now);
    return false;
}

/**
 * Rate limit by client IP address.
 */
export function rateLimitByIp(maxRequests: number, windowMs: number) {
    return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
        const ip =
            c.req.header("cf-connecting-ip") ??
            c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown";

        const key = `ip:${ip}`;
        if (isRateLimited(key, maxRequests, windowMs)) {
            return c.json({ error: "Too many requests" }, 429);
        }

        await next();
    };
}

/**
 * Rate limit by Bearer token (user-level).
 */
export function rateLimitByToken(maxRequests: number, windowMs: number) {
    return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
        const authHeader = c.req.header("Authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "anonymous";

        const key = `token:${token}`;
        if (isRateLimited(key, maxRequests, windowMs)) {
            return c.json({ error: "Too many requests" }, 429);
        }

        await next();
    };
}
