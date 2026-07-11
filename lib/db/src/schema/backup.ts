import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const backupLogsTable = pgTable("backup_logs", {
  id: serial("id").primaryKey(),
  weekLabel: text("week_label").notNull(),
  fileName: text("file_name").notNull(),
  fileId: text("file_id"),
  webViewLink: text("web_view_link"),
  rowsCleared: integer("rows_cleared").default(0),
  status: text("status").notNull(), // 'success' | 'failed'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BackupLog = typeof backupLogsTable.$inferSelect;
