import {
    pgTable,
    serial,
    integer,
    text,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    githubId: integer("github_id").notNull().unique(),
    githubUsername: text("github_username").notNull(),
    githubEmail: text("github_email"),
    githubAvatarUrl: text("github_avatar_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
});

export const metricEvents = pgTable(
    "metric_events",
    {
        id: serial("id").primaryKey(),
        userId: integer("user_id")
            .notNull()
            .references(() => users.id),
        eventType: text("event_type").notNull(),
        eventData: jsonb("event_data"),
        clientTimestamp: timestamp("client_timestamp").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("idx_metric_events_user_type").on(table.userId, table.eventType),
        index("idx_metric_events_created").on(table.createdAt),
    ],
);
