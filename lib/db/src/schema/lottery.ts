import { pgTable, serial, text, integer, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { ordersTable } from "./orders";
import { usersTable } from "./users";

export const lotteryEntriesTable = pgTable("lottery_entries", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  orderId: integer("order_id").notNull().references(() => ordersTable.id),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  luckyNumber: integer("lucky_number").notNull(),
  drawDate: text("draw_date").notNull(),
  luckyNumberSent: boolean("lucky_number_sent").notNull().default(false),
  manuallySent: boolean("manually_sent").notNull().default(false),
  luckyNumberSentAt: timestamp("lucky_number_sent_at", { withTimezone: true }),
  twilioMessageSid: text("twilio_message_sid"),
  sendAttempts: integer("send_attempts").notNull().default(0),
  isWinner: boolean("is_winner").notNull().default(false),
  prizeTier: text("prize_tier"),
  winnerNotified: boolean("winner_notified").notNull().default(false),
  winnerNotifiedAt: timestamp("winner_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lotteryDrawsTable = pgTable("lottery_draws", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  drawDate: text("draw_date").notNull(),
  drawTime: text("draw_time").notNull().default("22:00"),
  status: text("status").notNull().default("scheduled"),
  totalEntries: integer("total_entries").notNull().default(0),
  prizeConfig: text("prize_config").notNull().default('[{"tier":"First Prize","count":1,"prize":"Free Meal"}]'),
  drawnByUserId: integer("drawn_by_user_id").references(() => usersTable.id),
  drawnAt: timestamp("drawn_at", { withTimezone: true }),
  randomSeed: text("random_seed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lotteryWinnersTable = pgTable("lottery_winners", {
  id: serial("id").primaryKey(),
  drawId: integer("draw_id").notNull().references(() => lotteryDrawsTable.id),
  entryId: integer("entry_id").notNull().references(() => lotteryEntriesTable.id),
  prizeTier: text("prize_tier").notNull(),
  prizeDescription: text("prize_description").notNull(),
  notificationStatus: text("notification_status").notNull().default("pending"),
  notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
  twilioMessageSid: text("twilio_message_sid"),
  claimed: boolean("claimed").notNull().default(false),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedByUserId: integer("claimed_by_user_id").references(() => usersTable.id),
});

export const lotterySettingsTable = pgTable("lottery_settings", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  drawTime: text("draw_time").notNull().default("22:00"),
  autoRunEnabled: boolean("auto_run_enabled").notNull().default(false),
  prizeConfig: text("prize_config").notNull().default('[{"tier":"First Prize","count":1,"prize":"Free Meal"},{"tier":"Second Prize","count":3,"prize":"50% Discount"}]'),
  luckyNumberTemplate: text("lucky_number_template").notNull().default("🎉 ስለደንበኝነትዎ እናመሰግናለን! | Thank You for Choosing Us!\n\n🎟️ የዕጣ ቁጥርዎ | Your Lucky Number: {{lucky_number}}\n\n📌 እባክዎ ቁጥሩን ይያዙት። | Please keep this number for our upcoming prize draw."),
  winnerTemplate: text("winner_template").notNull().default("🎉 Congratulations!\nYour lucky number #{{lucky_number}} won!\nPrize: {{prize_description}}"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
