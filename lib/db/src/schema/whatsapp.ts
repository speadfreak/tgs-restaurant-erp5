import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { ordersTable } from "./orders";

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").references(() => branchesTable.id),
  orderId: integer("order_id").references(() => ordersTable.id),
  customerPhone: text("customer_phone").notNull(),
  direction: text("direction").notNull(),
  messageType: text("message_type").notNull().default("text"),
  content: text("content"),
  mediaUrl: text("media_url"),
  twilioMessageSid: text("twilio_message_sid"),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
