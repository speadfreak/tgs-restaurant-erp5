import { pgTable, serial, text, integer, boolean, timestamp, date, jsonb, unique } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { ordersTable } from "./orders";

export const streakPrizesTable = pgTable("streak_prizes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  prizeType: text("prize_type").notNull(),
  discountPercent: integer("discount_percent"),
  freeItemName: text("free_item_name"),
  customDescription: text("custom_description"),
  minDaysRequired: integer("min_days_required").notNull().default(4),
  minOrdersRequired: integer("min_orders_required").notNull().default(6),
  cycleLengthDays: integer("cycle_length_days").notNull().default(7),
  streakMode: text("streak_mode").notNull().default("window"),
  isActive: boolean("is_active").notNull().default(true),
  branchId: integer("branch_id").references(() => branchesTable.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerStreaksTable = pgTable("customer_streaks", {
  id: serial("id").primaryKey(),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  streakCode: text("streak_code").notNull().unique(),
  branchId: integer("branch_id").references(() => branchesTable.id),
  cycleStartDate: date("cycle_start_date", { mode: "string" }).notNull(),
  cycleEndDate: date("cycle_end_date", { mode: "string" }).notNull(),
  activeDays: integer("active_days").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  targetOrders: integer("target_orders"),
  activeDayDates: jsonb("active_day_dates").$type<string[]>().notNull().default([]),
  streakMode: text("streak_mode").notNull().default("window"),
  status: text("status").notNull().default("active"),
  prizeId: integer("prize_id").references(() => streakPrizesTable.id),
  wonAt: timestamp("won_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const streakActiveDaysTable = pgTable("streak_active_days", {
  id: serial("id").primaryKey(),
  streakId: integer("streak_id").notNull().references(() => customerStreaksTable.id),
  activeDate: date("active_date", { mode: "string" }).notNull(),
  orderId: integer("order_id").references(() => ordersTable.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  streakOrderUnique: unique("streak_active_days_streak_order_unique").on(table.streakId, table.orderId),
}));

export type StreakPrize = typeof streakPrizesTable.$inferSelect;
export type CustomerStreak = typeof customerStreaksTable.$inferSelect;