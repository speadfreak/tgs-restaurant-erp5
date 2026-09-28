import { Router, type Request } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  db,
  customerStreaksTable,
  streakPrizesTable,
} from "@workspace/db";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";
import {
  getActivePrize,
  getStreakSnapshot,
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

function statusLabel(streak: typeof customerStreaksTable.$inferSelect, minDays: number): string {
  if (streak.status === "won") return "winner";
  if (streak.status === "lost") return "reset";
  if (streak.activeDays >= minDays) return "on_track";
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
  const minDays = prize?.minDaysRequired ?? 4;
  return {
    id: streak.id,
    customerName: streak.customerName,
    customerPhone: streak.customerPhone,
    streakCode: streak.streakCode,
    branchId: streak.branchId,
    cycleStartDate: streak.cycleStartDate,
    cycleEndDate: streak.cycleEndDate,
    activeDays: streak.activeDays,
    activeDayDates: streak.activeDayDates,
    cycleLengthDays: prize?.cycleLengthDays ?? 7,
    minDaysRequired: minDays,
    streakMode: streak.streakMode,
    status: streak.status,
    displayStatus: statusLabel(streak, minDays),
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

router.get("/streaks/dashboard", async (req, res): Promise<void> => {
  const branchId = scopedBranchId(req);
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
    customDescription, minDaysRequired = 4, cycleLengthDays = 7,
    streakMode = "window", branchId, isActive = true,
  } = req.body ?? {};
  const minDays = Number(minDaysRequired);
  const cycleLength = Number(cycleLengthDays);
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Prize name is required" });
    return;
  }
  if (![5, 7, 10].includes(cycleLength) || !Number.isInteger(minDays) || minDays < 2 || minDays > cycleLength) {
    res.status(400).json({ error: "Cycle length must be 5, 7, or 10 and minimum days must fit within it" });
    return;
  }
  if (!["window", "consecutive"].includes(streakMode)) {
    res.status(400).json({ error: "Streak mode must be window or consecutive" });
    return;
  }
  if (req.user?.role === "branch_manager" && branchId !== req.user.branchId) {
    res.status(403).json({ error: "Branch managers can only configure their own branch" });
    return;
  }
  const [prize] = await db.insert(streakPrizesTable).values({
    name: name.trim(),
    description: typeof description === "string" ? description : null,
    prizeType,
    discountPercent: discountPercent == null ? null : Number(discountPercent),
    freeItemName: typeof freeItemName === "string" ? freeItemName : null,
    customDescription: typeof customDescription === "string" ? customDescription : null,
    minDaysRequired: minDays,
    cycleLengthDays: cycleLength,
    streakMode,
    isActive: Boolean(isActive),
    branchId: branchId == null ? null : Number(branchId),
  }).returning();
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
  const [prize] = await db.update(streakPrizesTable).set({
    ...(typeof req.body?.name === "string" ? { name: req.body.name.trim() } : {}),
    ...(req.body?.description !== undefined ? { description: req.body.description || null } : {}),
    ...(req.body?.prizeType !== undefined ? { prizeType: req.body.prizeType } : {}),
    ...(req.body?.discountPercent !== undefined ? { discountPercent: req.body.discountPercent == null ? null : Number(req.body.discountPercent) } : {}),
    ...(req.body?.freeItemName !== undefined ? { freeItemName: req.body.freeItemName || null } : {}),
    ...(req.body?.customDescription !== undefined ? { customDescription: req.body.customDescription || null } : {}),
    ...(req.body?.minDaysRequired !== undefined ? { minDaysRequired: Number(req.body.minDaysRequired) } : {}),
    ...(req.body?.cycleLengthDays !== undefined ? { cycleLengthDays: Number(req.body.cycleLengthDays) } : {}),
    ...(req.body?.streakMode !== undefined ? { streakMode: req.body.streakMode } : {}),
    ...(req.body?.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
  }).where(eq(streakPrizesTable.id, id)).returning();
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