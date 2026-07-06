import { pgTable, serial, text, boolean, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("order_staff"),
  branchId: integer("branch_id").references(() => branchesTable.id),
  baseSalary: numeric("base_salary", { precision: 10, scale: 2 }),
  active: boolean("active").notNull().default(true),
  passwordChanged: boolean("password_changed").notNull().default(false),
  chefStatus: text("chef_status").notNull().default("available"),
  currentStatus: text("current_status").notNull().default("available"),
  commissionRate: numeric("commission_rate", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
