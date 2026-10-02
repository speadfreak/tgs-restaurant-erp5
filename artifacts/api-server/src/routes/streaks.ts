import { Router, type Request } from "express";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  db,
  customersTable,
  customerStreaksTable,
  ordersTable,
  orderStatusHistoryTable,
  settingsTable,
  streakActiveDaysTable,
  streakPrizesTable,
} from "@workspace/db";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";
import {
  displayCustomerStreakIdentity,
  getActivePrize,
  getStreakSnapshot,
  processDeliveryStreak,
  resolveCustomerStreakIdentity,
} from "../lib/streak-engine";

const router: Router = Router();

function normalizePhone(value: string): string {
  return value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
}

function scopedBranchId(req: Request): number | undefined {
  if (req.user?.role === "branch_manager") return req.user.branchId ?? undefined;
  const raw = req.query.branchId;
  const parsed = raw === undefined ? undefined : Number(raw);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function sameBranchScope(branchId: number | null) {
  return branchId === null
    ? isNull(streakPrizesTable.branchId)
    : eq(streakPrizesTable.branchId, branchId);
}

let recentNameBackfill: Promise<number> | null = null;
let loyaltyResetInProgress: Promise<void> | null = null;

async function backfillRecentNamedDeliveries(branchId?: number): Promise<number> {
  while (loyaltyResetInProgress) await loyaltyResetInProgress;
  if (recentNameBackfill) return recentNameBackfill;

  recentNameBackfill = (async () => {
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    const [resetMarker] = await db.select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "streak_last_reset_at"));
    const resetDate = resetMarker ? new Date(resetMarker.value) : null;
    const validResetDate = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate : null;
    const deliveredOrders = await db.select({
      orderId: ordersTable.id,
      branchId: ordersTable.branchId,
      customerPhoneDirect: ordersTable.customerPhoneDirect,
      customerNameDirect: ordersTable.customerNameDirect,
      profilePhone: customersTable.phone,
      profileName: customersTable.name,
      deliveredAt: orderStatusHistoryTable.changedAt,
    })
      .from(ordersTable)
      .innerJoin(orderStatusHistoryTable, and(
        eq(orderStatusHistoryTable.orderId, ordersTable.id),
        eq(orderStatusHistoryTable.status, "delivered"),
      ))
      .leftJoin(customersTable, eq(customersTable.id, ordersTable.customerId))
      .leftJoin(streakActiveDaysTable, eq(streakActiveDaysTable.orderId, ordersTable.id))
      .where(and(
        eq(ordersTable.status, "delivered"),
        gte(orderStatusHistoryTable.changedAt, cutoff),
        validResetDate ? gt(orderStatusHistoryTable.changedAt, validResetDate) : undefined,
        isNull(streakActiveDaysTable.id),
        branchId === undefined ? undefined : eq(ordersTable.branchId, branchId),
      ))
      .orderBy(asc(orderStatusHistoryTable.changedAt), asc(ordersTable.id))
      .limit(1000);

    const candidates: { order: typeof deliveredOrders[number]; name: string; identity: string }[] = [];
    const seenOrderIds = new Set<number>();
    for (const order of deliveredOrders) {
      if (seenOrderIds.has(order.orderId)) continue;
      seenOrderIds.add(order.orderId);

      const phone = order.customerPhoneDirect?.trim() || order.profilePhone?.trim() || null;
      const name = order.customerNameDirect?.trim() || order.profileName?.trim() || "";
      const identity = resolveCustomerStreakIdentity(phone, name);
      if (identity.startsWith("name:")) candidates.push({ order, name, identity });
    }
    if (candidates.length === 0) return 0;

    const identities = [...new Set(candidates.map(candidate => candidate.identity))];
    const existingStreaks = await db.select({ customerPhone: customerStreaksTable.customerPhone })
      .from(customerStreaksTable)
      .where(inArray(customerStreaksTable.customerPhone, identities));
    const existingIdentities = new Set(existingStreaks.map(streak => streak.customerPhone));

    let backfilled = 0;
    for (const { order, name, identity } of candidates) {
      if (existingIdentities.has(identity)) continue;
      const result = await processDeliveryStreak(
        order.orderId,
        identity,
        name || identity.slice("name:".length),
        order.branchId,
        { deliveredAt: order.deliveredAt, suppressNotifications: true },
      );
      if (result) backfilled++;
    }
    return backfilled;
  })();

  try {
    return await recentNameBackfill;
  } finally {
    recentNameBackfill = null;
  }
}

function statusLabel(streak: typeof customerStreaksTable.$inferSelect, minOrders: number): string {
  if (streak.status === "won") return "winner";
  if (streak.status === "lost") return "reset";
  if (streak.orderCount >= minOrders) return "on_track";
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(`${streak.cycleEndDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000),
  );
  return daysLeft <= 1 ? "at_risk" : "in_progress";
}

async function mapStreak(streak: typeof customerStreaksTable.$inferSelect) {
  const prize = streak.prizeId
    ? (await db.select().from(streakPrizesTable).where(eq(streakPrizesTable.id, streak.prizeId)))[0] ?? null
    : await getActivePrize(streak.branchId ?? 0);
  const minOrders = streak.targetOrders || prize?.minOrdersRequired || prize?.minDaysRequired || 6;
  const ordersCompleted = streak.orderCount || streak.activeDayDates.length || streak.activeDays;
  const ordersRemaining = Math.max(0, minOrders - ordersCompleted);
  const daysLeft = streak.status === "active"
    ? Math.max(0, Math.ceil((new Date(`${streak.cycleEndDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 0;
  return {
    id: streak.id,
    customerName: streak.customerName,
    customerPhone: displayCustomerStreakIdentity(streak.customerPhone, streak.customerName),
    streakCode: streak.streakCode,
    branchId: streak.branchId,
    cycleStartDate: streak.cycleStartDate,
    cycleEndDate: streak.cycleEndDate,
    activeDays: streak.activeDays,
    activeDayDates: streak.activeDayDates,
    ordersCompleted,
    ordersRemaining,
    orderDates: streak.activeDayDates,
    cycleLengthDays: Math.max(1, Math.ceil((new Date(`${streak.cycleEndDate}T00:00:00Z`).getTime() - new Date(`${streak.cycleStartDate}T00:00:00Z`).getTime()) / 86_400_000) + 1),
    minOrdersRequired: minOrders,
    minDaysRequired: minOrders,
    daysLeft,
    streakMode: streak.streakMode,
    status: streak.status,
    displayStatus: statusLabel(streak, minOrders),
    prize: prize ? {
      id: prize.id,
      name: prize.name,
      description: prize.description,
      prizeType: prize.prizeType,
      discountPercent: prize.discountPercent,
      freeItemName: prize.freeItemName,
      customDescription: prize.customDescription,
    } : null,
    wonAt: streak.wonAt?.toISOString() ?? null,
    notifiedAt: streak.notifiedAt?.toISOString() ?? null,
    createdAt: streak.createdAt.toISOString(),
    updatedAt: streak.updatedAt.toISOString(),
  };
}

// Public by design: customers can check progress without an account.
router.get("/streaks/lookup", async (req, res): Promise<void> => {
  const phone = typeof req.query.phone === "string" ? normalizePhone(req.query.phone) : "";
  if (!phone) {
    res.status(400).json({ error: "Phone number is required" });
    return;
  }
  const snapshot = await getStreakSnapshot(phone);
  if (!snapshot) {
    res.status(404).json({ error: "No loyalty streak found for this phone number" });
    return;
  }
  res.json(snapshot);
});

router.use("/streaks", authenticate, requireRole(...ADMIN_ROLES));

router.post("/streaks/reset", async (req, res): Promise<void> => {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Only a super admin can reset the loyalty system" });
    return;
  }
  if (req.body?.confirmation !== "RESET") {
    res.status(400).json({ error: 'Type "RESET" to confirm this operation' });
    return;
  }

  while (loyaltyResetInProgress) await loyaltyResetInProgress;
  let releaseResetLock = () => {};
  loyaltyResetInProgress = new Promise<void>(resolve => { releaseResetLock = resolve; });
  try {
    if (recentNameBackfill) await recentNameBackfill.catch(() => 0);
    const resetAt = new Date();
    const summary = await db.transaction(async (tx) => {
      const progressRows = await tx.delete(streakActiveDaysTable)
        .returning({ id: streakActiveDaysTable.id });
      const challengeRows = await tx.delete(customerStreaksTable)
        .returning({ id: customerStreaksTable.id });
      const customerRows = await tx.update(customersTable)
        .set({ streakCode: null, currentStreakId: null })
        .where(or(
          isNotNull(customersTable.streakCode),
          isNotNull(customersTable.currentStreakId),
        ))
        .returning({ id: customersTable.id });
      await tx.insert(settingsTable).values({
        key: "streak_last_reset_at",
        value: resetAt.toISOString(),
        isSensitive: true,
      }).onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: resetAt.toISOString(), isSensitive: true },
      });

      return {
        deletedOrderProgress: progressRows.length,
        deletedChallenges: challengeRows.length,
        clearedCustomerLoyaltyRecords: customerRows.length,
      };
    });

    res.json({
      ...summary,
      message: "Loyalty challenges and progress have been reset. The prize catalogue and ERP records were kept.",
    });
  } finally {
    loyaltyResetInProgress = null;
    releaseResetLock();
  }
});

router.get("/streaks/dashboard", async (req, res): Promise<void> => {
  const branchId = scopedBranchId(req);
  try {
    const backfilled = await backfillRecentNamedDeliveries(branchId);
    if (backfilled > 0) req.log.info({ backfilled }, "Recovered untracked name-based loyalty orders");
  } catch (error) {
    req.log.warn({ error }, "Could not recover untracked name-based loyalty orders");
  }
  const filters = [eq(customerStreaksTable.status, "active")];
  if (branchId !== undefined) filters.push(eq(customerStreaksTable.branchId, branchId));
  const active = await db.select().from(customerStreaksTable).where(and(...filters)).orderBy(desc(customerStreaksTable.updatedAt));
  const rows = await Promise.all(active.map(mapStreak));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const recentWinnerSince = new Date(Date.now() - 7 * 86_400_000);
  const winners = await db.select().from(customerStreaksTable).where(
    and(
      eq(customerStreaksTable.status, "won"),
      branchId === undefined ? undefined : eq(customerStreaksTable.branchId, branchId),
    ),
  ).orderBy(desc(customerStreaksTable.wonAt)).limit(10);
  res.json({
    totals: {
      active: rows.length,
      onTrack: rows.filter(row => row.displayStatus === "on_track").length,
      endingToday: rows.filter(row => row.cycleEndDate === today).length,
      winnersThisWeek: winners.filter(row => row.wonAt && row.wonAt >= recentWinnerSince).length,
    },
    active: rows.slice(0, 100),
    recentWinners: await Promise.all(winners.map(mapStreak)),
  });
});

router.get("/streaks", async (req, res): Promise<void> => {
  const branchId = scopedBranchId(req);
  try {
    const backfilled = await backfillRecentNamedDeliveries(branchId);
    if (backfilled > 0) req.log.info({ backfilled }, "Recovered untracked name-based loyalty orders");
  } catch (error) {
    req.log.warn({ error }, "Could not recover untracked name-based loyalty orders");
  }
  const conditions = [];
  if (branchId !== undefined) conditions.push(eq(customerStreaksTable.branchId, branchId));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status) conditions.push(eq(customerStreaksTable.status, status));
  const rows = await db.select().from(customerStreaksTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(customerStreaksTable.updatedAt))
    .limit(300);
  res.json(await Promise.all(rows.map(mapStreak)));
});

router.get("/streaks/winners", async (req, res): Promise<void> => {
  const branchId = scopedBranchId(req);
  const rows = await db.select().from(customerStreaksTable).where(
    and(
      eq(customerStreaksTable.status, "won"),
      branchId === undefined ? undefined : eq(customerStreaksTable.branchId, branchId),
    ),
  ).orderBy(desc(customerStreaksTable.wonAt)).limit(300);
  res.json(await Promise.all(rows.map(mapStreak)));
});

router.get("/streaks/prizes", async (req, res): Promise<void> => {
  const branchId = scopedBranchId(req);
  const rows = await db.select().from(streakPrizesTable).where(
    and(
      isNull(streakPrizesTable.archivedAt),
      branchId === undefined
        ? undefined
        : or(eq(streakPrizesTable.branchId, branchId), isNull(streakPrizesTable.branchId)),
    ),
  ).orderBy(desc(streakPrizesTable.createdAt));
  res.json(rows);
});

router.post("/streaks/prizes", async (req, res): Promise<void> => {
  const {
    name, description, prizeType = "custom", discountPercent, freeItemName,
    customDescription, minOrdersRequired, minDaysRequired, cycleLengthDays = 7,
    streakMode = "window", branchId, isActive = true,
  } = req.body ?? {};
  const minOrders = Number(minOrdersRequired ?? minDaysRequired ?? 6);
  const cycleLength = Number(cycleLengthDays);
  const parsedBranchId = branchId == null ? null : Number(branchId);
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Prize name is required" });
    return;
  }
  if (!Number.isInteger(cycleLength) || cycleLength < 1 || cycleLength > 90 || !Number.isInteger(minOrders) || minOrders < 1 || minOrders > 100) {
    res.status(400).json({ error: "Challenge days must be between 1 and 90, and required orders must be between 1 and 100" });
    return;
  }
  if (!["window", "consecutive"].includes(streakMode)) {
    res.status(400).json({ error: "Streak mode must be window or consecutive" });
    return;
  }
  if (branchId != null && (!Number.isInteger(parsedBranchId) || parsedBranchId! < 1)) {
    res.status(400).json({ error: "Invalid branch id" });
    return;
  }
  if (req.user?.role === "branch_manager" && parsedBranchId !== req.user.branchId) {
    res.status(403).json({ error: "Branch managers can only configure their own branch" });
    return;
  }
  const active = typeof isActive === "boolean" ? isActive : true;
  const prize = await db.transaction(async (tx) => {
    if (active) {
      await tx.update(streakPrizesTable)
        .set({ isActive: false })
        .where(and(
          eq(streakPrizesTable.isActive, true),
          isNull(streakPrizesTable.archivedAt),
          sameBranchScope(parsedBranchId),
        ));
    }
    const [created] = await tx.insert(streakPrizesTable).values({
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      prizeType,
      discountPercent: discountPercent == null ? null : Number(discountPercent),
      freeItemName: typeof freeItemName === "string" ? freeItemName : null,
      customDescription: typeof customDescription === "string" ? customDescription : null,
      minDaysRequired: minOrders,
      minOrdersRequired: minOrders,
      cycleLengthDays: cycleLength,
      streakMode,
      isActive: active,
      branchId: parsedBranchId,
    }).returning();
    return created;
  });
  res.status(201).json(prize);
});

router.patch("/streaks/prizes/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid prize id" });
    return;
  }
  const existing = (await db.select().from(streakPrizesTable).where(eq(streakPrizesTable.id, id)))[0];
  if (!existing) {
    res.status(404).json({ error: "Prize not found" });
    return;
  }
  if (req.user?.role === "branch_manager" && existing.branchId !== req.user.branchId) {
    res.status(403).json({ error: "You cannot edit this prize" });
    return;
  }
  const updates = {
    ...(typeof req.body?.name === "string" ? { name: req.body.name.trim() } : {}),
    ...(req.body?.description !== undefined ? { description: req.body.description || null } : {}),
    ...(req.body?.prizeType !== undefined ? { prizeType: req.body.prizeType } : {}),
    ...(req.body?.discountPercent !== undefined ? { discountPercent: req.body.discountPercent == null ? null : Number(req.body.discountPercent) } : {}),
    ...(req.body?.freeItemName !== undefined ? { freeItemName: req.body.freeItemName || null } : {}),
    ...(req.body?.customDescription !== undefined ? { customDescription: req.body.customDescription || null } : {}),
    ...(req.body?.minOrdersRequired !== undefined || req.body?.minDaysRequired !== undefined
      ? {
        minDaysRequired: Number(req.body?.minOrdersRequired ?? req.body?.minDaysRequired),
        minOrdersRequired: Number(req.body?.minOrdersRequired ?? req.body?.minDaysRequired),
      }
      : {}),
    ...(req.body?.cycleLengthDays !== undefined ? { cycleLengthDays: Number(req.body.cycleLengthDays) } : {}),
    ...(req.body?.streakMode !== undefined ? { streakMode: req.body.streakMode } : {}),
    ...(req.body?.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
  };
  const prize = await db.transaction(async (tx) => {
    if (req.body?.isActive === true) {
      await tx.update(streakPrizesTable)
        .set({ isActive: false })
        .where(and(
          eq(streakPrizesTable.isActive, true),
          isNull(streakPrizesTable.archivedAt),
          sameBranchScope(existing.branchId),
        ));
    }
    const [updated] = await tx.update(streakPrizesTable)
      .set(updates)
      .where(eq(streakPrizesTable.id, id))
      .returning();
    return updated;
  });
  res.json(prize);
});

router.delete("/streaks/prizes/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const existing = (await db.select().from(streakPrizesTable).where(eq(streakPrizesTable.id, id)))[0];
  if (!existing) {
    res.status(404).json({ error: "Prize not found" });
    return;
  }
  if (req.user?.role === "branch_manager" && existing.branchId !== req.user.branchId) {
    res.status(403).json({ error: "You cannot delete this prize" });
    return;
  }

  const referencedStreak = (await db.select({ id: customerStreaksTable.id })
    .from(customerStreaksTable)
    .where(eq(customerStreaksTable.prizeId, id))
    .limit(1))[0];

  if (referencedStreak) {
    // Keep the reward row for historical streaks, but remove it from the
    // catalogue so deleting a prize never breaks the FK or customer history.
    const [archived] = await db.update(streakPrizesTable)
      .set({ isActive: false, archivedAt: new Date() })
      .where(eq(streakPrizesTable.id, id))
      .returning();
    res.json({ archived: true, prize: archived });
    return;
  }

  await db.delete(streakPrizesTable).where(eq(streakPrizesTable.id, id));
  res.status(204).end();
});

export default router;