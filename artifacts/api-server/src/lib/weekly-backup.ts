/**
 * Weekly backup + clear engine — the core of Phase 8.
 *
 * Exports all operational/transactional data to a branded Excel workbook,
 * uploads it to Google Drive, then clears that data from the database so the
 * free-tier Neon database never fills up. Never touches master data (users,
 * branches, menu, inventory, suppliers, settings, customers, backup_logs).
 *
 * Correctness guarantees (see the code-review pass that shaped this design):
 *  - Every table that gets cleared has a matching sheet in backup-generator.ts.
 *    Nothing is ever deleted without being captured in the exported file.
 *  - The SELECTs (via generateBackupExcel) and the DELETEs run inside the SAME
 *    REPEATABLE READ transaction. Under Postgres MVCC, an UPDATE/DELETE in a
 *    REPEATABLE READ transaction only ever touches rows visible in that
 *    transaction's snapshot — so any order/entry inserted concurrently, after
 *    the backup snapshot was taken, is invisible to the DELETEs and survives.
 *    This closes the "insert during backup gets silently deleted" race.
 *  - The whole clear phase (all table deletes + the success log row) commits
 *    as one atomic transaction — either everything is cleared and logged, or
 *    (on any failure, including the Drive upload) nothing is touched at all.
 */
import { generateBackupExcel } from "./backup-generator";
import { uploadFileToDrive } from "./google-drive";
import { getSetting } from "./settings";
import { sendTeamsNotification } from "./teams";
import { sendWhatsAppMessage } from "./twilio";
import { eq } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  orderStatusHistoryTable,
  deliveriesTable,
  lotteryEntriesTable,
  lotteryDrawsTable,
  lotteryWinnersTable,
  financeEntriesTable,
  expensesTable,
  commissionsTable,
  timesheetsTable,
  whatsappMessagesTable,
  importShipmentsTable,
  importShipmentItemsTable,
  importPaymentsTable,
  loginAttemptsTable,
  staffActivitiesTable,
  backupLogsTable,
} from "@workspace/db";

export interface WeeklyBackupResult {
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  error?: string;
  rowsCleared: number;
}

export async function runWeeklyBackup(): Promise<WeeklyBackupResult> {
  const now = new Date();
  const weekLabel = now.toISOString().split("T")[0]; // e.g. "2026-07-11"
  const fileName = `TG-Restaurant-Backup-Week-${weekLabel}.xlsx`;

  try {
    const result = await db.transaction(
      async (tx) => {
        // Step 1 — Generate Excel from a snapshot taken inside this transaction.
        console.log("[Backup] Generating Excel file...");
        const buffer = await generateBackupExcel(weekLabel, tx);
        console.log(`[Backup] Excel generated — ${(buffer.length / 1024).toFixed(1)} KB`);

        // Step 2 — Upload to Google Drive. If this throws (not configured, API
        // error, etc.) the whole transaction rolls back — nothing is cleared.
        console.log("[Backup] Uploading to Google Drive...");
        const folderId = await getSetting("google_drive_folder_id");
        const { fileId, webViewLink } = await uploadFileToDrive(
          fileName,
          buffer,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          folderId,
        );
        console.log(`[Backup] Uploaded — file ID: ${fileId}`);

        // Step 3 — Clear operational data, children before parents (FK-safe order).
        // Because this runs in the same REPEATABLE READ transaction as the
        // SELECTs above, only rows that existed at snapshot time (i.e. rows
        // that ARE in the Excel file) can be deleted.
        console.log("[Backup] Clearing operational data...");
        await tx.delete(whatsappMessagesTable);
        await tx.delete(lotteryWinnersTable);
        await tx.delete(lotteryEntriesTable);
        await tx.delete(lotteryDrawsTable);
        await tx.delete(commissionsTable);
        await tx.delete(orderStatusHistoryTable);
        await tx.delete(orderItemsTable);
        await tx.delete(deliveriesTable);
        await tx.delete(importPaymentsTable);
        await tx.delete(importShipmentItemsTable);
        await tx.delete(importShipmentsTable);
        const deletedOrders = await tx.delete(ordersTable).returning();
        await tx.delete(financeEntriesTable);
        await tx.delete(expensesTable);
        await tx.delete(timesheetsTable);
        await tx.delete(loginAttemptsTable);
        // Only completed staff activities are cleared — anything still pending/in-progress stays.
        await tx.delete(staffActivitiesTable).where(eq(staffActivitiesTable.status, "done"));

        const rowsCleared = deletedOrders.length;
        console.log(`[Backup] Cleared ${rowsCleared} orders and all related operational data`);

        // Step 4 — Log the backup, atomically with the clear above.
        await tx.insert(backupLogsTable).values({
          weekLabel,
          fileName,
          fileId,
          webViewLink,
          rowsCleared,
          status: "success",
          createdAt: now,
        });

        return { fileId, webViewLink, rowsCleared };
      },
      { isolationLevel: "repeatable read" },
    );

    // Step 5 — Notifications (both silently no-op if not configured). Outside
    // the transaction since it has already committed successfully.
    await sendTeamsNotification(
      "✅ Weekly Backup Complete",
      `TG's Restaurant data for week of ${weekLabel} has been backed up to Google Drive and the database has been cleared.\n\nOrders backed up: ${result.rowsCleared}\nFile: ${fileName}\nLink: ${result.webViewLink}`,
      "#22C55E",
    );
    const notifyPhone = await getSetting("backup_notify_whatsapp");
    if (notifyPhone) {
      await sendWhatsAppMessage(
        notifyPhone,
        `✅ TG's Restaurant — Weekly backup complete for week of ${weekLabel}.\nOrders backed up: ${result.rowsCleared}\nSaved to Google Drive: ${fileName}`,
      );
    }

    console.log("[Backup] Weekly backup complete");
    return { success: true, fileId: result.fileId, webViewLink: result.webViewLink, rowsCleared: result.rowsCleared };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Backup] Failed:", message);

    // The transaction above rolled back entirely on any failure, so nothing
    // was cleared. Log the failure on a fresh (non-transactional) write.
    await db
      .insert(backupLogsTable)
      .values({
        weekLabel,
        fileName,
        fileId: null,
        webViewLink: null,
        rowsCleared: 0,
        status: "failed",
        errorMessage: message,
        createdAt: now,
      })
      .catch(() => {
        /* never let a logging failure mask the real error */
      });

    await sendTeamsNotification(
      "❌ Weekly Backup Failed",
      `TG's Restaurant weekly backup for week of ${weekLabel} failed: ${message}\n\nThe database was NOT cleared — no data was lost.`,
      "#EF4444",
    ).catch(() => {});

    return { success: false, error: message, rowsCleared: 0 };
  }
}
