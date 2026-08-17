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
  customersTable,
} from "@workspace/db";
import { sendWhatsAppMessage } from "../lib/twilio";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";
import { loadLotteryWinnerHistory, selectFairWinners, uaeDate as getUaeDate } from "../lib/lottery-selection";

const router: Router = Router();
router.use("/lottery", authenticate, requireRole(...ADMIN_ROLES));

const DEFAULT_LUCKY_NUMBER_TEMPLATE = "🎉 ስለደንበኝነትዎ እናመሰግናለን! | Thank You for Choosing Us!\n\n🎟️ የዕጣ ቁጥርዎ | Your Lucky Number: {{lucky_number}}\n\n📌 እባክዎ ቁጥሩን ይያዙት። | Please keep this number for our upcoming prize draw.";

function renderLuckyNumberMessage(template: string, luckyNumber: number, drawTime: string): string {
  return template
    .replace(/\{\{lucky_number\}\}/g, String(luckyNumber))
    .replace(/\{\{draw_time\}\}/g, drawTime);
}

function uaeDate(date = new Date()): string {
  return getUaeDate(date);
}

function orderCreatedOnUaeDate(createdAt: Date, date: string): boolean {
  return uaeDate(createdAt) === date;
}

async function createEntryForOrder(
  order: typeof ordersTable.$inferSelect,
  drawDate: string,
): Promise<{ entry: typeof lotteryEntriesTable.$inferSelect | null; created: boolean; reason?: string }> {
  if (order.status === "cancelled") return { entry: null, created: false, reason: "Order is cancelled" };

  const existing = (await db.select().from(lotteryEntriesTable).where(
    and(eq(lotteryEntriesTable.orderId, order.id), eq(lotteryEntriesTable.drawDate, drawDate))
  ))[0];
  if (existing) return { entry: existing, created: false, reason: "Already in session" };

  const customer = order.customerId
    ? (await db.select({ phone: customersTable.phone, name: customersTable.name }).from(customersTable).where(eq(customersTable.id, order.customerId)))[0]
    : null;
  const phone = order.customerPhoneDirect ?? customer?.phone ?? null;
  if (!phone) return { entry: null, created: false, reason: "Order has no customer phone number" };

  let luckyNumber = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    luckyNumber = Math.floor(100000 + Math.random() * 900000);
    const collision = await db.select({ id: lotteryEntriesTable.id }).from(lotteryEntriesTable).where(
      and(
        eq(lotteryEntriesTable.branchId, order.branchId),
        eq(lotteryEntriesTable.drawDate, drawDate),
        eq(lotteryEntriesTable.luckyNumber, luckyNumber),
      )
    );
    if (!collision.length) break;
    if (attempt === 19) return { entry: null, created: false, reason: "Could not generate a unique lucky number" };
  }

  const [entry] = await db.insert(lotteryEntriesTable).values({
    branchId: order.branchId,
    orderId: order.id,
    customerPhone: phone,
    customerName: order.customerNameDirect ?? customer?.name ?? null,
    luckyNumber,
    drawDate,
    luckyNumberSent: false,
  }).returning();
  return { entry, created: true };
}

async function syncLotteryEntries(branchId: number, drawDate: string) {
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.branchId, branchId));
  const candidates = orders.filter(o => o.status !== "cancelled" && orderCreatedOnUaeDate(o.createdAt, drawDate));
  const results = await Promise.all(candidates.map(order => createEntryForOrder(order, drawDate)));
  return {
    scanned: candidates.length,
    created: results.filter(r => r.created).map(r => r.entry),
    skipped: results.flatMap((r, index) => r.created ? [] : [{ reason: r.reason, orderId: candidates[index]?.id }]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRIES
// ─────────────────────────────────────────────────────────────────────────────

// GET /lottery/entries?branchId=&date=&pendingOnly=true
// pendingOnly=true returns only entries from dates that have NO completed draw yet
router.get("/lottery/entries", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  const date = req.query.date as string | undefined;
  const pendingOnly = req.query.pendingOnly === "true";

  let rows = await db.select().from(lotteryEntriesTable).orderBy(desc(lotteryEntriesTable.createdAt));
  if (branchId) rows = rows.filter(e => e.branchId === branchId);
  if (date) rows = rows.filter(e => e.drawDate === date);

  // pendingOnly: exclude entries whose drawDate has a completed draw for this branch
  if (pendingOnly && branchId) {
    const draws = await db.select().from(lotteryDrawsTable)
      .then(all => all.filter(d => d.branchId === branchId && d.status === "completed"));
    const completedDates = new Set(draws.map(d => d.drawDate));
    rows = rows.filter(e => !completedDates.has(e.drawDate));
  }

  // Enrich with orderCode
  const orderIds = [...new Set(rows.map(r => r.orderId))];
  const orders = orderIds.length
    ? await db.select({ id: ordersTable.id, orderCode: ordersTable.orderCode }).from(ordersTable)
        .then(all => all.filter(o => orderIds.includes(o.id)))
    : [];
  const orderCodeMap = new Map(orders.map(o => [o.id, o.orderCode]));

  res.json(rows.map(r => ({ ...r, orderCode: orderCodeMap.get(r.orderId) ?? null })));
});

// Reconcile all orders for a UAE calendar date into the lottery session. This
// is safe to run repeatedly and repairs entries missed during order creation.
router.post("/lottery/entries/sync", async (req, res): Promise<void> => {
  const branchId = Number(req.body?.branchId);
  const drawDate = typeof req.body?.drawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.drawDate)
    ? req.body.drawDate
    : uaeDate();
  if (!Number.isInteger(branchId) || branchId <= 0) {
    res.status(400).json({ error: "branchId is required" });
    return;
  }

  const result = await syncLotteryEntries(branchId, drawDate);
  res.json({
    branchId,
    drawDate,
    scanned: result.scanned,
    created: result.created,
    createdCount: result.created.length,
    skipped: result.skipped,
  });
});

// Super admins can add one or more order codes/IDs to a session when an
// automatic reconciliation cannot identify an order.
router.post("/lottery/entries/manual", async (req, res): Promise<void> => {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Only super admins can add manual lottery entries" });
    return;
  }

  const branchId = Number(req.body?.branchId);
  const drawDate = typeof req.body?.drawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.drawDate)
    ? req.body.drawDate
    : uaeDate();
  const rawCodes: unknown[] = Array.isArray(req.body?.orderCodes)
    ? req.body.orderCodes
    : [req.body?.orderCode ?? req.body?.orderNumber];
  const codes = rawCodes
    .flatMap((value: unknown) => String(value ?? "").split(/[,\n]/))
    .map((value: string) => value.trim())
    .filter(Boolean);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    res.status(400).json({ error: "branchId is required" });
    return;
  }
  if (!codes.length) {
    res.status(400).json({ error: "Add at least one order code or order number" });
    return;
  }

  const orders = await db.select().from(ordersTable).where(eq(ordersTable.branchId, branchId));
  const added: unknown[] = [];
  const existing: string[] = [];
  const errors: Array<{ value: string; reason: string }> = [];

  for (const value of [...new Set(codes)]) {
    const order = orders.find(o => o.orderCode.toLowerCase() === value.toLowerCase() || String(o.id) === value);
    if (!order) {
      errors.push({ value, reason: "Order not found in this branch" });
      continue;
    }
    const result = await createEntryForOrder(order, drawDate);
    if (result.created && result.entry) added.push({ ...result.entry, orderCode: order.orderCode });
    else if (result.reason === "Already in session") existing.push(order.orderCode);
    else errors.push({ value, reason: result.reason ?? "Could not add order" });
  }

  res.json({ branchId, drawDate, added, addedCount: added.length, existing, errors });
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
  const date = drawDate ?? uaeDate();

  // Always reconcile before creating a draw so a transient order-time
  // failure cannot silently remove an order from the session.
  await syncLotteryEntries(Number(branchId), date);

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

  // Fetch entries that were sent (via Twilio or manual confirmation). Also
  // exclude cancelled orders so a stale entry can never win.
  const candidateEntries = await db.select().from(lotteryEntriesTable).where(
    and(
      eq(lotteryEntriesTable.branchId, draw.branchId),
      eq(lotteryEntriesTable.drawDate, draw.drawDate),
      or(
        eq(lotteryEntriesTable.luckyNumberSent, true),
        eq(lotteryEntriesTable.manuallySent, true)
      )
    )
  );
  const candidateOrderIds = [...new Set(candidateEntries.map(entry => entry.orderId))];
  const candidateOrders = candidateOrderIds.length
    ? await db.select({ id: ordersTable.id, status: ordersTable.status }).from(ordersTable)
    : [];
  const cancelledOrderIds = new Set(candidateOrders.filter(order => order.status === "cancelled").map(order => order.id));
  const entries = candidateEntries.filter(entry => !cancelledOrderIds.has(entry.orderId));

  if (entries.length === 0) {
    res.status(400).json({ error: "No eligible entries for this draw — mark at least one number as sent first" }); return;
  }

  // Generate a crypto seed. The fairness selector uses this seed to break
  // ties while keeping the outcome auditable from the draw record.
  const seedBytes = crypto.randomBytes(32);
  const seed = seedBytes.toString("hex");

  // Parse prize config
  let prizeConfig: Array<{ tier: string; count: number; prize: string }> = [];
  try {
    prizeConfig = JSON.parse(draw.prizeConfig);
  } catch {
    prizeConfig = [{ tier: "First Prize", count: 1, prize: "Free Meal" }];
  }

  const totalPrizeSlots = prizeConfig.reduce(
    (total, tier) => total + Math.max(0, Math.floor(Number(tier.count) || 0)),
    0,
  );
  const history = await loadLotteryWinnerHistory(draw.branchId);
  const selection = selectFairWinners(entries, history, totalPrizeSlots, seed);

  const [settings] = await db.select().from(lotterySettingsTable).where(
    eq(lotterySettingsTable.branchId, draw.branchId)
  );
  const winnerTemplate = settings?.winnerTemplate ?? "🎉 Congratulations!\nYour lucky number #{{lucky_number}} won!\nPrize: {{prize_description}}";

  const winners = [];
  let entryIndex = 0;

  for (const tier of prizeConfig) {
    const tierCount = Math.max(0, Math.floor(Number(tier.count) || 0));
    for (let i = 0; i < tierCount; i++) {
      if (entryIndex >= selection.winners.length) break;
      const entry = selection.winners[entryIndex++];

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

  res.json({
    drawId: draw.id,
    seed,
    totalEntries: entries.length,
    winners,
    selection: selection.summary,
  });
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
