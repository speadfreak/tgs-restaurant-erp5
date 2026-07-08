import { pgTable, serial, text, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";
import { usersTable } from "./users";
import { ordersTable } from "./orders";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  category: text("category").notNull(),
  amountAed: numeric("amount_aed", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  loggedBy: integer("logged_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commissionsTable = pgTable("commissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  amountAed: numeric("amount_aed", { precision: 10, scale: 2 }).notNull(),
  type: text("type").notNull().default("delivery"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Finance entries logged manually by finance_staff.
 * Both income and expense entries; distinct from order-derived revenue
 * and the legacy admin-only expenses table.
 */
export const financeEntriesTable = pgTable("finance_entries", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  loggedByUserId: integer("logged_by_user_id").notNull().references(() => usersTable.id),
  entryType: text("entry_type").notNull(), // 'income' | 'expense'
  category: text("category").notNull(),
  amountAed: numeric("amount_aed", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  entryDate: text("entry_date").notNull(), // YYYY-MM-DD
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;

export const insertCommissionSchema = createInsertSchema(commissionsTable).omit({ id: true, createdAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissionsTable.$inferSelect;

export const insertFinanceEntrySchema = createInsertSchema(financeEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinanceEntry = z.infer<typeof insertFinanceEntrySchema>;
export type FinanceEntry = typeof financeEntriesTable.$inferSelect;
