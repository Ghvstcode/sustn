import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./lib/config.js";
import { auth } from "./routes/auth.js";
import { health } from "./routes/health.js";
import { metrics } from "./routes/metrics.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.route("/", auth);
app.route("/", health);
app.route("/", metrics);

console.log(`SUSTN auth server starting on port ${config.port}`);

serve({
    fetch: app.fetch,
    port: config.port,
});
