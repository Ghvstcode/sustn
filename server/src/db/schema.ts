import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    githubId: integer("github_id").notNull().unique(),
    githubUsername: text("github_username").notNull(),
    githubEmail: text("github_email"),
    githubAvatarUrl: text("github_avatar_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
});
