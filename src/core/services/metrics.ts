import { getAuth } from "@core/db/auth";
import { config } from "@core/config";
import { getGlobalSettings } from "@core/db/settings";

interface MetricEvent {
    eventType: string;
    eventData?: Record<string, unknown>;
    clientTimestamp: string;
}

class MetricsService {
    private queue: MetricEvent[] = [];
    private flushTimer: ReturnType<typeof setInterval> | undefined;
    private isFlushing = false;
    private readonly FLUSH_INTERVAL = 30_000;
    private readonly BATCH_THRESHOLD = 20;
    private readonly MAX_QUEUE = 200;
    private readonly ENDPOINT = `${config.authServerUrl}/metrics/events`;

    start() {
        this.flushTimer = setInterval(
            () => void this.flush(),
            this.FLUSH_INTERVAL,
        );
    }

    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
        void this.flush();
    }

    async track(eventType: string, eventData?: Record<string, unknown>) {
        // Check if analytics is enabled before tracking
        const settings = await getGlobalSettings();
        if (!settings.analyticsEnabled) {
            return;
        }

        this.queue.push({
            eventType,
            eventData,
            clientTimestamp: new Date().toISOString(),
        });

        if (this.queue.length >= this.BATCH_THRESHOLD) {
            void this.flush();
        }
    }

    private async flush() {
        // Prevent concurrent flushes to avoid race condition
        if (this.isFlushing || this.queue.length === 0) return;

        this.isFlushing = true;

        try {
            // Double-check analytics is still enabled before sending
            const settings = await getGlobalSettings();
            if (!settings.analyticsEnabled) {
                this.queue = []; // Clear the queue if analytics was disabled
                return;
            }

            // Extract events to send, keeping queue intact for new events
            const events = this.queue.splice(0);
            const auth = await getAuth();
            if (!auth?.accessToken) {
                // Re-queue events if no auth token
                this.queue.unshift(...events);
                return;
            }

            try {
                const response = await fetch(this.ENDPOINT, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${auth.accessToken}`,
                    },
                    body: JSON.stringify({ events }),
                });

                if (
                    !response.ok &&
                    this.queue.length + events.length <= this.MAX_QUEUE
                ) {
                    // Re-insert failed events at the front of the queue
                    this.queue.unshift(...events);
                }
            } catch {
                if (this.queue.length + events.length <= this.MAX_QUEUE) {
                    // Re-insert failed events at the front of the queue
                    this.queue.unshift(...events);
                }
            }
        } finally {
            this.isFlushing = false;
        }
    }
}

export const metrics = new MetricsService();
