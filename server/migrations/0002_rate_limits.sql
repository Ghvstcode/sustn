-- Rate limiting table for sliding-window counters (shared across Worker isolates)

CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (key, window_start)
);
