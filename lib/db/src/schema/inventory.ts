import { pgTable, serial, text, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";
import { usersTable } from "./users";

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  quantityOnHand: numeric("quantity_on_hand", { precision: 10, scale: 3 }).notNull().default("0"),
  reorderThreshold: numeric("reorder_threshold", { precision: 10, scale: 3 }).notNull().default("0"),
  reorderQuantity: numeric("reorder_quantity", { precision: 10, scale: 3 }).notNull().default("0"),
  preferredSupplierId: integer("preferred_supplier_id"),
  supplier: text("supplier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wasteLogsTable = pgTable("waste_logs", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  ingredientId: integer("ingredient_id").notNull().references(() => inventoryItemsTable.id),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  reason: text("reason").notNull(),
  loggedBy: integer("logged_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;

export const insertWasteLogSchema = createInsertSchema(wasteLogsTable).omit({ id: true, createdAt: true });
export type InsertWasteLog = z.infer<typeof insertWasteLogSchema>;
export type WasteLog = typeof wasteLogsTable.$inferSelect;
