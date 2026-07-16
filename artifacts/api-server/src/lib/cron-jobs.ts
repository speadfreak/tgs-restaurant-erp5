import cron from "node-cron";
import {
  db, cronJobLogsTable,
  lotteryEntriesTable, lotterySettingsTable, lotteryDrawsTable, lotteryWinnersTable,
  importShipmentsTable, ordersTable, branchesTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { sendWhatsAppMessage } from "./twilio";
import { getSetting } from "./settings";
import { runWeeklyBackup } from "./weekly-backup";

const DEFAULT_LUCKY_NUMBER_TEMPLATE = "🎉 ስለደንበኝነትዎ እናመሰግናለን! | Thank You for Choosing Us!\n\n🎟️ የዕጣ ቁጥርዎ | Your Lucky Number: {{lucky_number}}\n\n📌 እባክዎ ቁጥሩን ይያዙት። | Please keep this number for our upcoming prize draw.";

function renderLuckyNumberMessage(template: string, luckyNumber: number, drawTime: string): string {
  return template
    .replace(/\{\{lucky_number\}\}/g, String(luckyNumber))
    .replace(/\{\{draw_time\}\}/g, drawTime);
}

async function logJob(jobName: string, success: boolean, message: string) {
  try {
    await db.insert(cronJobLogsTable).values({
      jobName,
      status: success ? "success" : "failed",
      message,
      completedAt: new Date(),
    });
  } catch { /* never crash */ }
}

// ── 1. DAILY LOTTERY DRAW ───────────────────────────────────────────────────
// Runs at 18:00 UTC = 22:00 UAE (GMT+4)
export async function runDailyLotteryDrawForBranch(branchId: number) {
  const today = new Date().toISOString().split("T")[0];
  try {
    const [settings] = await db.select().from(lotterySettingsTable).where(eq(lotterySettingsTable.branchId, branchId));
    if (!settings?.autoRunEnabled) {
      await logJob("daily_lottery_draw", true, `Branch ${branchId}: autoRun disabled`);
      return;
    }

    const existing = await db.select().from(lotteryDrawsTable)
      .where(and(eq(lotteryDrawsTable.branchId, branchId), eq(lotteryDrawsTable.drawDate, today), eq(lotteryDrawsTable.status, "completed")));
    if (existing.length > 0) {
      await logJob("daily_lottery_draw", true, `Branch ${branchId}: already drawn today`);
      return;
    }

    const entries = await db.select().from(lotteryEntriesTable)
      .where(and(eq(lotteryEntriesTable.branchId, branchId), eq(lotteryEntriesTable.drawDate, today)));
    if (entries.length === 0) {
      await logJob("daily_lottery_draw", true, `Branch ${branchId}: no entries`);
      return;
    }

    const prizeConfig: { tier: string; count: number; prize: string }[] = JSON.parse(settings.prizeConfig);
    const shuffled = [...entries].sort(() => Math.random() - 0.5);

    const [draw] = await db.insert(lotteryDrawsTable).values({
      branchId,
      drawDate: today,
      drawTime: settings.drawTime,
      status: "completed",
      totalEntries: entries.length,
      prizeConfig: settings.prizeConfig,
      drawnAt: new Date(),
      randomSeed: Math.random().toString(36).slice(2),
    }).returning();

    let entryIdx = 0;
    for (const tier of prizeConfig) {
      for (let i = 0; i < tier.count && entryIdx < shuffled.length; i++, entryIdx++) {
        const entry = shuffled[entryIdx];
        await db.insert(lotteryWinnersTable).values({
          drawId: draw.id,
          entryId: entry.id,
          prizeTier: tier.tier,
          prizeDescription: tier.prize,
          notificationStatus: "pending",
        });
        await db.update(lotteryEntriesTable).set({ isWinner: true, prizeTier: tier.tier }).where(eq(lotteryEntriesTable.id, entry.id));

        const msg = `🎉 Congratulations!\nYour lucky number #${entry.luckyNumber} WON!\nPrize: ${tier.prize}\nShow this message at TG's Restaurant to claim.`;
        const result = await sendWhatsAppMessage(entry.customerPhone, msg);
        if (result.ok) {
          await db.update(lotteryWinnersTable).set({ notificationStatus: "sent", notificationSentAt: new Date(), twilioMessageSid: result.sid })
            .where(and(eq(lotteryWinnersTable.drawId, draw.id), eq(lotteryWinnersTable.entryId, entry.id)));
        }
      }
    }
    await logJob("daily_lottery_draw", true, `Branch ${branchId}: draw complete — ${entries.length} entries`);
  } catch (err) {
    await logJob("daily_lottery_draw", false, `Branch ${branchId}: ${String(err)}`);
  }
}

// ── 2. LUCKY NUMBER RETRY ───────────────────────────────────────────────────
// Every 15 minutes — resend to unsent entries with < 3 attempts
export async function retryLuckyNumbers() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const pending = await db.select().from(lotteryEntriesTable)
      .where(and(eq(lotteryEntriesTable.luckyNumberSent, false), eq(lotteryEntriesTable.drawDate, today)));
    const toRetry = pending.filter(e => e.sendAttempts < 3);
    let sent = 0;
    for (const entry of toRetry) {
      const [settings] = await db.select().from(lotterySettingsTable).where(eq(lotterySettingsTable.branchId, entry.branchId));
      const drawTime = settings?.drawTime ?? "22:00";
      const msg = renderLuckyNumberMessage(settings?.luckyNumberTemplate ?? DEFAULT_LUCKY_NUMBER_TEMPLATE, entry.luckyNumber, drawTime);
      const result = await sendWhatsAppMessage(entry.customerPhone, msg, entry.orderId, entry.branchId);
      if (result.ok) {
        await db.update(lotteryEntriesTable).set({
          sendAttempts: entry.sendAttempts + 1,
          luckyNumberSent: true,
          luckyNumberSentAt: new Date(),
          twilioMessageSid: result.sid ?? null,
        }).where(eq(lotteryEntriesTable.id, entry.id));
        sent++;
      } else {
        await db.update(lotteryEntriesTable).set({ sendAttempts: entry.sendAttempts + 1 }).where(eq(lotteryEntriesTable.id, entry.id));
      }
    }
    if (toRetry.length > 0) {
      await logJob("lucky_number_retry", true, `Retried ${toRetry.length}, sent ${sent}`);
    }
  } catch (err) {
    await logJob("lucky_number_retry", false, String(err));
  }
}

// ── 3. QUEUE RESET LOG ──────────────────────────────────────────────────────
// Midnight UAE = 20:00 UTC
export async function logQueueReset() {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const [{ count }] = await db.select({ count: sql<number>`COUNT(*)` }).from(ordersTable)
      .where(and(eq(ordersTable.channel, "whatsapp_voice"), sql`DATE(created_at AT TIME ZONE 'UTC') = ${yesterday}`));
    await logJob("queue_number_reset", true, `Day reset. Yesterday had ${count} WhatsApp orders`);
  } catch (err) {
    await logJob("queue_number_reset", false, String(err));
  }
}

// ── 4. IMPORT OVERDUE CHECK ─────────────────────────────────────────────────
// Daily at 05:00 UTC = 09:00 UAE
export async function checkOverdueShipments() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const all = await db.select().from(importShipmentsTable)
      .where(sql`estimated_arrival_date IS NOT NULL AND estimated_arrival_date < ${today}`);
    const overdue = all.filter(s => s.status !== "received" && s.status !== "discrepancy_noted");
    await logJob("import_overdue_check", true, `${overdue.length} overdue shipment(s)`);
    for (const s of overdue) {
      console.warn(`[Overdue Shipment] ${s.reference} — due ${s.estimatedArrivalDate}, status: ${s.status}`);
    }
  } catch (err) {
    await logJob("import_overdue_check", false, String(err));
  }
}

// ── 5. WEEKLY GOOGLE DRIVE BACKUP + DB CLEAR ────────────────────────────────
// Every Sunday at 20:00 UTC = midnight UAE (UTC+4). Silent no-op when the
// admin has not enabled auto-backup in Settings → Google Drive & Backup.
export async function runScheduledWeeklyBackup() {
  const enabled = await getSetting("google_drive_enabled");
  if (enabled !== "true") {
    await logJob("weekly_backup", true, "Auto-backup disabled in settings — skipped");
    return;
  }
  console.log("[Cron] Starting weekly backup...");
  const result = await runWeeklyBackup();
  if (result.success) {
    await logJob("weekly_backup", true, `Backed up & cleared ${result.rowsCleared} orders — ${result.webViewLink}`);
    console.log(`[Cron] Weekly backup success — ${result.rowsCleared} orders cleared`);
  } else {
    await logJob("weekly_backup", false, result.error ?? "Unknown error");
    console.error(`[Cron] Weekly backup failed: ${result.error}`);
  }
}

// ── START ALL CRON JOBS ─────────────────────────────────────────────────────
export function startCronJobs() {
  // Daily draw at 18:00 UTC (22:00 UAE)
  cron.schedule("0 18 * * *", async () => {
    console.log("[Cron] Running daily lottery draw...");
    const branches = await db.select({ id: branchesTable.id }).from(branchesTable);
    for (const b of branches) await runDailyLotteryDrawForBranch(b.id);
  }, { timezone: "UTC" });

  // Lucky number retry disabled — lucky numbers are no longer sent via Twilio automatically

  // Queue reset log at 20:00 UTC (midnight UAE)
  cron.schedule("0 20 * * *", () => { logQueueReset().catch(console.error); });

  // Import overdue check at 05:00 UTC (09:00 UAE)
  cron.schedule("0 5 * * *", () => { checkOverdueShipments().catch(console.error); });

  // Weekly Google Drive backup + DB clear — Sunday 20:00 UTC (midnight UAE)
  cron.schedule("0 20 * * 0", () => { runScheduledWeeklyBackup().catch(console.error); }, { timezone: "UTC" });

  console.log("[Cron] Phase 4+8 cron jobs scheduled (draw@18UTC, retry@*/15, reset@20UTC, overdue@05UTC, backup@Sun20UTC)");
}
