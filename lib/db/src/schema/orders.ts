import { pgTable, serial, text, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";
import { customersTable } from "./customers";
import { menuItemsTable } from "./menu";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderCode: text("order_code").notNull().unique(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  channel: text("channel").notNull().default("webapp"),
  status: text("status").notNull().default("pending_acceptance"),
  totalAed: numeric("total_aed", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentMethod: text("payment_method"),
  deliveryAddress: text("delivery_address"),
  customerNameDirect: text("customer_name_direct"),
  customerPhoneDirect: text("customer_phone_direct"),
  relayedByUserId: integer("relayed_by_user_id"),
  acceptedByUserId: integer("accepted_by_user_id"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  markedReadyByUserId: integer("marked_ready_by_user_id"),
  markedReadyAt: timestamp("marked_ready_at", { withTimezone: true }),
  assignedDeliveryUserId: integer("assigned_delivery_user_id"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  queueNumber: integer("queue_number"),
  whatsappMessageId: text("whatsapp_message_id"),
  whatsappMessageType: text("whatsapp_message_type"),
  whatsappMediaUrl: text("whatsapp_media_url"),
  autoReplySent: boolean("auto_reply_sent").default(true),
  intakeClaimedByUserId: integer("intake_claimed_by_user_id"),
  intakeClaimedAt: timestamp("intake_claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItemsTable.id),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
});

export const orderStatusHistoryTable = pgTable("order_status_history", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  status: text("status").notNull(),
  changedBy: integer("changed_by"),
  note: text("note"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recordNotesTable = pgTable("record_notes", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  authorId: integer("author_id").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffActivitiesTable = pgTable("staff_activities", {
  id: serial("id").primaryKey(),
  assignedToUserId: integer("assigned_to_user_id").notNull(),
  assignedByUserId: integer("assigned_by_user_id").notNull(),
  branchId: integer("branch_id").references(() => branchesTable.id),
  title: text("title").notNull(),
  dueDate: text("due_date"),
  status: text("status").notNull().default("pending"),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: integer("related_entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({ id: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
