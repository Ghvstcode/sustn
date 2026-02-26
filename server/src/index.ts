import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Bindings } from "./lib/config.js";
import { auth } from "./routes/auth.js";
import { health } from "./routes/health.js";
import { metrics } from "./routes/metrics.js";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use("*", async (c, next) => {
    const allowedOrigins = c.env.ALLOWED_ORIGINS.split(",").map((o) =>
        o.trim(),
    );
    const middleware = cors({
        origin: allowedOrigins,
        allowMethods: ["GET", "POST"],
        allowHeaders: ["Authorization", "Content-Type"],
    });
    return middleware(c, next);
});

app.route("/", auth);
app.route("/", health);
app.route("/", metrics);

export default app;
