import { Router } from "express";
import { eq, and, desc, or, inArray } from "drizzle-orm";
import * as crypto from "crypto";
import {
  db,
  lotteryEntriesTable,
  lotteryDrawsTable,
  lotteryWinnersTable,
  lotterySettingsTable,
  ordersTable,
} from "@workspace/db";
import { sendWhatsAppMessage } from "../lib/twilio";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use("/lottery", authenticate, requireRole(...ADMIN_ROLES));

const DEFAULT_LUCKY_NUMBER_TEMPLATE = "🎉 ስለደንበኝነትዎ እናመሰግናለን! | Thank You for Choosing Us!\n\n🎟️ የዕጣ ቁጥርዎ | Your Lucky Number: {{lucky_number}}\n\n📌 እባክዎ ቁጥሩን ይያዙት። | Please keep this number for our upcoming prize draw.";

function renderLuckyNumberMessage(template: string, luckyNumber: number, drawTime: string): string {
  return template
    .replace(/\{\{lucky_number\}\}/g, String(luckyNumber))
    .replace(/\{\{draw_time\}\}/g, drawTime);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRIES
// ─────────────────────────────────────────────────────────────────────────────

// GET /lottery/entries?branchId=&date=
router.get("/lottery/entries", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  const date = req.query.date as string | undefined;

  let rows = await db.select().from(lotteryEntriesTable).orderBy(desc(lotteryEntriesTable.createdAt));
  if (branchId) rows = rows.filter(e => e.branchId === branchId);
  if (date) rows = rows.filter(e => e.drawDate === date);

  // Enrich with orderCode
  const orderIds = [...new Set(rows.map(r => r.orderId))];
  const orders = orderIds.length
    ? await db.select({ id: ordersTable.id, orderCode: ordersTable.orderCode }).from(ordersTable)
        .then(all => all.filter(o => orderIds.includes(o.id)))
    : [];
  const orderCodeMap = new Map(orders.map(o => [o.id, o.orderCode]));

  res.json(rows.map(r => ({ ...r, orderCode: orderCodeMap.get(r.orderId) ?? null })));
});

// GET /lottery/entries/by-phone?phone= — public endpoint for customer lucky number lookup
router.get("/lottery/entries/by-phone", async (req, res): Promise<void> => {
  const phone = (req.query.phone as string ?? "").replace(/\s+/g, "").replace(/^whatsapp:/, "");
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const rows = await db.select({
    id: lotteryEntriesTable.id,
    luckyNumber: lotteryEntriesTable.luckyNumber,
    drawDate: lotteryEntriesTable.drawDate,
    isWinner: lotteryEntriesTable.isWinner,
    prizeTier: lotteryEntriesTable.prizeTier,
    luckyNumberSent: lotteryEntriesTable.luckyNumberSent,
    customerPhone: lotteryEntriesTable.customerPhone,
  }).from(lotteryEntriesTable)
    .where(eq(lotteryEntriesTable.customerPhone, phone))
    .orderBy(desc(lotteryEntriesTable.drawDate));
  res.json(rows);
});

// PATCH /lottery/entries/:id/manually-sent — toggle manually_sent flag
router.patch("/lottery/entries/:id/manually-sent", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const manuallySent = req.body.manuallySent === true;
  const [entry] = await db.update(lotteryEntriesTable)
    .set({ manuallySent })
    .where(eq(lotteryEntriesTable.id, id))
    .returning();
  if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
  res.json({ id: entry.id, manuallySent: entry.manuallySent });
});

// POST /lottery/entries/retry/:id — retry sending lucky number
router.post("/lottery/entries/retry/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [entry] = await db.select().from(lotteryEntriesTable).where(eq(lotteryEntriesTable.id, id));
  if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
  if (entry.luckyNumberSent) { res.status(400).json({ error: "Lucky number already sent" }); return; }

  const [settings] = await db.select().from(lotterySettingsTable).where(eq(lotterySettingsTable.branchId, entry.branchId));
  const drawTime = settings?.drawTime ?? "22:00";
  const msg = renderLuckyNumberMessage(settings?.luckyNumberTemplate ?? DEFAULT_LUCKY_NUMBER_TEMPLATE, entry.luckyNumber, drawTime);

  const result = await sendWhatsAppMessage(entry.customerPhone, msg, entry.orderId, entry.branchId);
  await db.update(lotteryEntriesTable).set({
    sendAttempts: (entry.sendAttempts ?? 0) + 1,
    luckyNumberSent: result.ok,
    luckyNumberSentAt: result.ok ? new Date() : entry.luckyNumberSentAt,
    twilioMessageSid: result.sid ?? entry.twilioMessageSid,
  }).where(eq(lotteryEntriesTable.id, id));

  res.json({ ok: result.ok, error: result.error });
});

// ─────────────────────────────────────────────────────────────────────────────
// DRAWS
// ─────────────────────────────────────────────────────────────────────────────

// GET /lottery/draws?branchId=
router.get("/lottery/draws", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  let rows = await db.select().from(lotteryDrawsTable).orderBy(desc(lotteryDrawsTable.drawDate));
  if (branchId) rows = rows.filter(d => d.branchId === branchId);
  res.json(rows);
});

// POST /lottery/draws — create draw for today
router.post("/lottery/draws", async (req, res): Promise<void> => {
  const { branchId, drawDate, drawTime } = req.body;
  if (!branchId) { res.status(400).json({ error: "branchId required" }); return; }
  const date = drawDate ?? new Date().toISOString().split("T")[0];

  // Count eligible entries for this date
  const entries = await db.select().from(lotteryEntriesTable).where(
    and(eq(lotteryEntriesTable.branchId, branchId), eq(lotteryEntriesTable.drawDate, date))
  );

  const [settings] = await db.select().from(lotterySettingsTable).where(eq(lotterySettingsTable.branchId, branchId));
  const prizeConfig = settings?.prizeConfig ?? '[{"tier":"First Prize","count":1,"prize":"Free Meal"}]';
  const time = drawTime ?? settings?.drawTime ?? "22:00";

  const [draw] = await db.insert(lotteryDrawsTable).values({
    branchId,
    drawDate: date,
    drawTime: time,
    status: "scheduled",
    totalEntries: entries.length,
    prizeConfig,
  }).returning();

  res.status(201).json(draw);
});

// POST /lottery/draws/:id/run — execute draw with crypto seed, send winner WA msgs
router.post("/lottery/draws/:id/run", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { userId } = req.body;

  const [draw] = await db.select().from(lotteryDrawsTable).where(eq(lotteryDrawsTable.id, id));
  if (!draw) { res.status(404).json({ error: "Draw not found" }); return; }
  if (draw.status === "completed") { res.status(400).json({ error: "Draw already completed" }); return; }

  // Fetch eligible entries: either sent via Twilio OR manually marked by admin
  const entries = await db.select().from(lotteryEntriesTable).where(
    and(
      eq(lotteryEntriesTable.branchId, draw.branchId),
      eq(lotteryEntriesTable.drawDate, draw.drawDate),
      or(
        eq(lotteryEntriesTable.luckyNumberSent, true),
        eq(lotteryEntriesTable.manuallySent, true)
      )
    )
  );

  if (entries.length === 0) {
    res.status(400).json({ error: "No eligible entries for this draw — mark at least one number as sent first" }); return;
  }

  // Generate crypto seed for reproducible randomness
  const seedBytes = crypto.randomBytes(32);
  const seed = seedBytes.toString("hex");

  // Shuffle entries using seeded approach (Fisher-Yates with crypto bytes)
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = seedBytes[i % seedBytes.length] % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Parse prize config
  let prizeConfig: Array<{ tier: string; count: number; prize: string }> = [];
  try {
    prizeConfig = JSON.parse(draw.prizeConfig);
  } catch {
    prizeConfig = [{ tier: "First Prize", count: 1, prize: "Free Meal" }];
  }

  const [settings] = await db.select().from(lotterySettingsTable).where(
    eq(lotterySettingsTable.branchId, draw.branchId)
  );
  const winnerTemplate = settings?.winnerTemplate ?? "🎉 Congratulations!\nYour lucky number #{{lucky_number}} won!\nPrize: {{prize_description}}";

  const winners = [];
  let entryIndex = 0;

  for (const tier of prizeConfig) {
    for (let i = 0; i < tier.count; i++) {
      if (entryIndex >= shuffled.length) break;
      const entry = shuffled[entryIndex++];

      const [winner] = await db.insert(lotteryWinnersTable).values({
        drawId: draw.id,
        entryId: entry.id,
        prizeTier: tier.tier,
        prizeDescription: tier.prize,
        notificationStatus: "pending",
      }).returning();

      // Mark entry as winner
      await db.update(lotteryEntriesTable).set({
        isWinner: true,
        prizeTier: tier.tier,
      }).where(eq(lotteryEntriesTable.id, entry.id));

      // Send winner WhatsApp notification
      const msg = winnerTemplate
        .replace("{{lucky_number}}", String(entry.luckyNumber))
        .replace("{{prize_description}}", tier.prize);

      const notifResult = await sendWhatsAppMessage(
        entry.customerPhone,
        msg,
        entry.orderId,
        draw.branchId
      );

      const notifStatus = notifResult.ok ? "sent" : "failed";
      await db.update(lotteryWinnersTable).set({
        notificationStatus: notifStatus,
        notificationSentAt: notifResult.ok ? new Date() : undefined,
        twilioMessageSid: notifResult.sid ?? null,
      }).where(eq(lotteryWinnersTable.id, winner.id));

      if (notifResult.ok) {
        await db.update(lotteryEntriesTable).set({
          winnerNotified: true,
          winnerNotifiedAt: new Date(),
        }).where(eq(lotteryEntriesTable.id, entry.id));
      }

      winners.push({
        winnerId: winner.id,
        entryId: entry.id,
        customerPhone: entry.customerPhone,
        customerName: entry.customerName ?? null,
        luckyNumber: entry.luckyNumber,
        prizeTier: tier.tier,
        prizeDescription: tier.prize,
        notificationStatus: notifStatus,
      });
    }
  }

  // Mark draw as completed
  await db.update(lotteryDrawsTable).set({
    status: "completed",
    drawnByUserId: userId ?? null,
    drawnAt: new Date(),
    randomSeed: seed,
    totalEntries: entries.length,
  }).where(eq(lotteryDrawsTable.id, draw.id));

  res.json({ drawId: draw.id, seed, totalEntries: entries.length, winners });
});

// POST /lottery/draws/:id/reset — void a completed draw and reset to scheduled for a re-run
router.post("/lottery/draws/:id/reset", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [draw] = await db.select().from(lotteryDrawsTable).where(eq(lotteryDrawsTable.id, id));
  if (!draw) { res.status(404).json({ error: "Draw not found" }); return; }
  if (draw.status === "scheduled") { res.status(400).json({ error: "Draw is already in scheduled state" }); return; }

  // Find all winners for this draw so we can reset their entries
  const winnerRows = await db.select().from(lotteryWinnersTable).where(eq(lotteryWinnersTable.drawId, id));
  const entryIds = winnerRows.map(w => w.entryId);

  // Reset entry win flags in bulk
  if (entryIds.length > 0) {
    await db.update(lotteryEntriesTable).set({
      isWinner: false,
      prizeTier: null,
      winnerNotified: false,
      winnerNotifiedAt: null,
    }).where(inArray(lotteryEntriesTable.id, entryIds));
  }

  // Remove all winner records for this draw
  await db.delete(lotteryWinnersTable).where(eq(lotteryWinnersTable.drawId, id));

  // Reset the draw itself back to scheduled with a clean slate
  const [updated] = await db.update(lotteryDrawsTable).set({
    status: "scheduled",
    drawnByUserId: null,
    drawnAt: null,
    randomSeed: null,
  }).where(eq(lotteryDrawsTable.id, id)).returning();

  res.json({ ok: true, draw: updated, winnersCleared: entryIds.length });
});

// GET /lottery/draws/:id/winners — full winner details for a specific draw
router.get("/lottery/draws/:id/winners", async (req, res): Promise<void> => {
  const drawId = parseInt(req.params.id, 10);
  if (isNaN(drawId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db.select({
    winnerId: lotteryWinnersTable.id,
    entryId: lotteryWinnersTable.entryId,
    prizeTier: lotteryWinnersTable.prizeTier,
    prizeDescription: lotteryWinnersTable.prizeDescription,
    notificationStatus: lotteryWinnersTable.notificationStatus,
    notificationSentAt: lotteryWinnersTable.notificationSentAt,
    claimed: lotteryWinnersTable.claimed,
    claimedAt: lotteryWinnersTable.claimedAt,
    customerPhone: lotteryEntriesTable.customerPhone,
    customerName: lotteryEntriesTable.customerName,
    luckyNumber: lotteryEntriesTable.luckyNumber,
    orderId: lotteryEntriesTable.orderId,
  }).from(lotteryWinnersTable)
    .innerJoin(lotteryEntriesTable, eq(lotteryWinnersTable.entryId, lotteryEntriesTable.id))
    .where(eq(lotteryWinnersTable.drawId, drawId))
    .orderBy(lotteryWinnersTable.id);

  res.json(rows);
});

// PATCH /lottery/winners/:id/claimed — mark a prize as claimed/unclaimed
router.patch("/lottery/winners/:id/claimed", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { userId } = req.body;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const claimed = req.body.claimed === true;

  const [winner] = await db.update(lotteryWinnersTable).set({
    claimed,
    claimedAt: claimed ? new Date() : null,
    claimedByUserId: claimed ? (userId ?? null) : null,
  }).where(eq(lotteryWinnersTable.id, id)).returning();

  if (!winner) { res.status(404).json({ error: "Winner not found" }); return; }
  res.json({ id: winner.id, claimed: winner.claimed, claimedAt: winner.claimedAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

// GET /lottery/settings/:branchId
router.get("/lottery/settings/:branchId", async (req, res): Promise<void> => {
  const branchId = parseInt(req.params.branchId, 10);
  const [settings] = await db.select().from(lotterySettingsTable).where(eq(lotterySettingsTable.branchId, branchId));
  if (!settings) {
    // Return defaults
    res.json({
      branchId,
      drawTime: "22:00",
      autoRunEnabled: false,
      prizeConfig: '[{"tier":"First Prize","count":1,"prize":"Free Meal"},{"tier":"Second Prize","count":3,"prize":"50% Discount"}]',
      luckyNumberTemplate: DEFAULT_LUCKY_NUMBER_TEMPLATE,
      winnerTemplate: "🎉 Congratulations!\nYour lucky number #{{lucky_number}} won!\nPrize: {{prize_description}}",
    });
    return;
  }
  res.json(settings);
});

// PUT /lottery/settings/:branchId
router.put("/lottery/settings/:branchId", async (req, res): Promise<void> => {
  const branchId = parseInt(req.params.branchId, 10);
  const { drawTime, autoRunEnabled, prizeConfig, luckyNumberTemplate, winnerTemplate } = req.body;

  const [existing] = await db.select().from(lotterySettingsTable).where(eq(lotterySettingsTable.branchId, branchId));
  if (existing) {
    const [updated] = await db.update(lotterySettingsTable).set({
      drawTime: drawTime ?? existing.drawTime,
      autoRunEnabled: autoRunEnabled ?? existing.autoRunEnabled,
      prizeConfig: prizeConfig ?? existing.prizeConfig,
      luckyNumberTemplate: luckyNumberTemplate ?? existing.luckyNumberTemplate,
      winnerTemplate: winnerTemplate ?? existing.winnerTemplate,
      updatedAt: new Date(),
    }).where(eq(lotterySettingsTable.branchId, branchId)).returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(lotterySettingsTable).values({
      branchId,
      drawTime: drawTime ?? "22:00",
      autoRunEnabled: autoRunEnabled ?? false,
      prizeConfig: prizeConfig ?? '[{"tier":"First Prize","count":1,"prize":"Free Meal"},{"tier":"Second Prize","count":3,"prize":"50% Discount"}]',
      luckyNumberTemplate: luckyNumberTemplate ?? DEFAULT_LUCKY_NUMBER_TEMPLATE,
      winnerTemplate: winnerTemplate ?? "🎉 Congratulations!\nYour lucky number #{{lucky_number}} won!\nPrize: {{prize_description}}",
    }).returning();
    res.json(created);
  }
});

export default router;
