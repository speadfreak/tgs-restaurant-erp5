import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";
import { inventoryItemsTable } from "./inventory";
import { suppliersTable } from "./suppliers";

export const restockOrdersTable = pgTable("restock_orders", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  ingredientId: integer("ingredient_id").notNull().references(() => inventoryItemsTable.id),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  status: text("status").notNull().default("draft"), // draft | approved | received
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRestockOrderSchema = createInsertSchema(restockOrdersTable).omit({ id: true, createdAt: true });
export type InsertRestockOrder = z.infer<typeof insertRestockOrderSchema>;
export type RestockOrder = typeof restockOrdersTable.$inferSelect;
