import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const loginAttemptsTable = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  userId: integer("user_id"),
  ipAddress: text("ip_address"),
  success: boolean("success").notNull().default(false),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LoginAttempt = typeof loginAttemptsTable.$inferSelect;
