import { Router } from "express";
import { eq, and, gte, lte, inArray, or } from "drizzle-orm";
import {
  db,
  expensesTable,
  ordersTable,
  orderItemsTable,
  orderStatusHistoryTable,
  deliveriesTable,
  commissionsTable,
  usersTable,
  settingsTable,
  financeEntriesTable,
  branchesTable,
  lotteryEntriesTable,
  lotteryWinnersTable,
  whatsappMessagesTable,
} from "@workspace/db";
import {
  ListExpensesQueryParams,
  ListExpensesResponse,
  CreateExpenseBody,
  CreateExpenseResponse,
  DeleteExpenseParams,
  GetFinanceSummaryQueryParams,
  GetFinanceSummaryResponse,
  GetRevenueTrendQueryParams,
  GetRevenueTrendResponse,
  PreviewFinanceCleanupQueryParams,
  PreviewFinanceCleanupResponse,
  CleanupFinanceBody,
  CleanupFinanceResponse,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES, FINANCE_ROLES } from "../middlewares/auth";

const router: Router = Router();

// ── STAFF SELF-SERVICE EARNINGS ──────────────────────────────────────────────
// Accessible to ALL authenticated users — each person sees only their own data.

router.get("/finance/commissions/mine", authenticate, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  let records = await db.select().from(commissionsTable)
    .where(eq(commissionsTable.userId, userId));

  if (from) records = records.filter(c => c.createdAt.toISOString() >= from);
  if (to) records = records.filter(c => c.createdAt.toISOString() <= to + "T23:59:59Z");

  records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const totalAed = records.reduce((s, c) => s + Number(c.amountAed), 0);
  const orderCount = records.length;

  // Determine commission rate based on role
  const role = req.user!.role;
  let rateInfo: { ratePerOrder?: number; ratePercent?: number; rateType: "flat" | "percent" };
  if (role === "kitchen_staff") {
    const [ps] = await db.select().from(settingsTable).where(eq(settingsTable.key, "chef_commission_percent"));
    const percent = ps ? parseFloat(ps.value) : 5;
    rateInfo = { ratePercent: percent, rateType: "percent" };
  } else {
    const [rs] = await db.select().from(settingsTable).where(eq(settingsTable.key, "delivery_commission_per_order"));
    const rate = rs ? parseFloat(rs.value) : 10;
    rateInfo = { ratePerOrder: rate, rateType: "flat" };
  }

  res.json({
    userId,
    name: req.user!.name,
    role,
    type: role === "kitchen_staff" ? "chef" : "delivery",
    totalAed,
    orderCount,
    avgPerOrder: orderCount > 0 ? totalAed / orderCount : 0,
    ...rateInfo,
    records: records.map(c => ({
      id: c.id,
      orderId: c.orderId,
      amountAed: Number(c.amountAed),
      type: c.type,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

// ── FINANCE ENTRIES — accessible to finance_staff + admin ────────────────────

router.get("/finance/entries", authenticate, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);

  // finance_staff must have an assigned branch — block unassigned users outright
  if (!isAdmin && !req.user!.branchId) {
    res.status(403).json({ error: "Your account has no branch assigned — contact your administrator" });
    return;
  }

  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const date = req.query.date as string | undefined;

  let entries = await db.select().from(financeEntriesTable);

  // finance_staff is always scoped to their own branch — they cannot query other branches
  if (!isAdmin) {
    entries = entries.filter(e => e.branchId === req.user!.branchId!);
  } else if (branchId) {
    entries = entries.filter(e => e.branchId === branchId);
  }

  if (date) {
    entries = entries.filter(e => e.entryDate === date);
  }

  entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const allUsers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(allUsers.map(u => [u.id, u.name]));

  const allBranches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  const branchMap = new Map(allBranches.map(b => [b.id, b.name]));

  res.json(entries.map(e => ({
    id: e.id,
    branchId: e.branchId,
    branchName: branchMap.get(e.branchId) ?? null,
    loggedByUserId: e.loggedByUserId,
    loggedByName: userMap.get(e.loggedByUserId) ?? null,
    entryType: e.entryType,
    category: e.category,
    amountAed: Number(e.amountAed),
    description: e.description,
    referenceNumber: e.referenceNumber ?? null,
    notes: e.notes ?? null,
    entryDate: e.entryDate,
    isLocked: e.isLocked,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  })));
});

router.post("/finance/entries", authenticate, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);

  // finance_staff without a branch cannot create entries
  if (!isAdmin && !req.user!.branchId) {
    res.status(403).json({ error: "Your account has no branch assigned — contact your administrator" });
    return;
  }

  const { entryType, category, amountAed, description, referenceNumber, notes, entryDate, branchId: bodyBranchId } = req.body;
  if (!entryType || !category || !amountAed || !description || !entryDate) {
    res.status(400).json({ error: "Missing required fields: entryType, category, amountAed, description, entryDate" });
    return;
  }
  if (!["income", "expense"].includes(entryType)) {
    res.status(400).json({ error: "entryType must be 'income' or 'expense'" });
    return;
  }
  // finance_staff always uses their own branch — they cannot create entries for other branches
  const effectiveBranchId: number = isAdmin && bodyBranchId
    ? parseInt(bodyBranchId, 10)
    : req.user!.branchId!;
  if (!effectiveBranchId) { res.status(400).json({ error: "No branch available" }); return; }

  const [entry] = await db.insert(financeEntriesTable).values({
    branchId: effectiveBranchId,
    loggedByUserId: req.user!.id,
    entryType,
    category,
    amountAed: String(amountAed),
    description,
    referenceNumber: referenceNumber ?? null,
    notes: notes ?? null,
    entryDate,
  }).returning();

  res.status(201).json({
    id: entry.id,
    branchId: entry.branchId,
    loggedByUserId: entry.loggedByUserId,
    entryType: entry.entryType,
    category: entry.category,
    amountAed: Number(entry.amountAed),
    description: entry.description,
    referenceNumber: entry.referenceNumber ?? null,
    notes: entry.notes ?? null,
    entryDate: entry.entryDate,
    isLocked: entry.isLocked,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  });
});

router.patch("/finance/entries/:id", authenticate, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [current] = await db.select().from(financeEntriesTable).where(eq(financeEntriesTable.id, id));
  if (!current) { res.status(404).json({ error: "Entry not found" }); return; }
  if (current.isLocked) { res.status(403).json({ error: "Entry is locked and cannot be edited" }); return; }

  // Only allow editing within 24 hours for finance_staff (admins can always edit)
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);
  const ageMs = Date.now() - current.createdAt.getTime();
  if (!isAdmin && ageMs > 24 * 60 * 60 * 1000) {
    res.status(403).json({ error: "Entry can only be edited within 24 hours" });
    return;
  }
  // finance_staff cannot edit entries from other branches
  if (!isAdmin && req.user!.branchId && current.branchId !== req.user!.branchId) {
    res.status(403).json({ error: "Cannot edit entries from another branch" });
    return;
  }

  const { entryType, category, amountAed, description, referenceNumber, notes, entryDate, isLocked } = req.body;
  const updates: Partial<typeof financeEntriesTable.$inferInsert> = {};
  if (entryType !== undefined) updates.entryType = entryType;
  if (category !== undefined) updates.category = category;
  if (amountAed !== undefined) updates.amountAed = String(amountAed);
  if (description !== undefined) updates.description = description;
  if (referenceNumber !== undefined) updates.referenceNumber = referenceNumber;
  if (notes !== undefined) updates.notes = notes;
  if (entryDate !== undefined) updates.entryDate = entryDate;
  if (isAdmin && isLocked !== undefined) updates.isLocked = Boolean(isLocked);

  const [updated] = await db.update(financeEntriesTable).set(updates).where(eq(financeEntriesTable.id, id)).returning();
  res.json({ ...updated, amountAed: Number(updated.amountAed) });
});

router.delete("/finance/entries/:id", authenticate, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [current] = await db.select().from(financeEntriesTable).where(eq(financeEntriesTable.id, id));
  if (!current) { res.status(404).json({ error: "Entry not found" }); return; }
  if (current.isLocked) { res.status(403).json({ error: "Entry is locked and cannot be deleted" }); return; }

  const isAdmin = ADMIN_ROLES.includes(req.user!.role);
  // finance_staff can only delete within 1 hour
  if (!isAdmin && Date.now() - current.createdAt.getTime() > 60 * 60 * 1000) {
    res.status(403).json({ error: "Entry can only be deleted within 1 hour of creation" });
    return;
  }
  if (!isAdmin && req.user!.branchId && current.branchId !== req.user!.branchId) {
    res.status(403).json({ error: "Cannot delete entries from another branch" });
    return;
  }

  await db.delete(financeEntriesTable).where(eq(financeEntriesTable.id, id));
  res.json({ ok: true });
});

router.get("/finance/entries/summary", authenticate, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);
  if (!isAdmin && !req.user!.branchId) {
    res.status(403).json({ error: "Your account has no branch assigned" });
    return;
  }
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : (req.user!.branchId ?? null);
  const date = (req.query.date as string) ?? new Date().toISOString().split("T")[0];

  let entries = await db.select().from(financeEntriesTable).where(eq(financeEntriesTable.entryDate, date));
  if (!isAdmin && branchId) entries = entries.filter(e => e.branchId === branchId);
  else if (branchId) entries = entries.filter(e => e.branchId === branchId);

  const totalIncome = entries.filter(e => e.entryType === "income").reduce((s, e) => s + Number(e.amountAed), 0);
  const totalExpense = entries.filter(e => e.entryType === "expense").reduce((s, e) => s + Number(e.amountAed), 0);

  res.json({ date, branchId, totalIncome, totalExpense, netBalance: totalIncome - totalExpense, entryCount: entries.length });
});

// ── COMMISSION RATES (public read — all authenticated staff need this) ───────
router.get("/finance/commission-rates", authenticate, async (_req, res): Promise<void> => {
  const chefPercent = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, "chef_commission_percent"));
  const delivery = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, "delivery_commission_per_order"));
  res.json({
    chefCommissionPercent: chefPercent[0] ? parseFloat(chefPercent[0].value) : 5,
    deliveryCommissionPerOrder: delivery[0] ? parseFloat(delivery[0].value) : 10,
  });
});

// ── ADMIN-ONLY MIDDLEWARE ────────────────────────────────────────────────────
router.use("/finance", authenticate, requireRole(...ADMIN_ROLES));

function mapExpense(e: typeof expensesTable.$inferSelect, loggedByName?: string | null) {
  return {
    id: e.id,
    branchId: e.branchId,
    category: e.category,
    amountAed: Number(e.amountAed),
    description: e.description,
    loggedBy: e.loggedBy ?? null,
    loggedByName: loggedByName ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/finance/expenses", async (req, res): Promise<void> => {
  const q = ListExpensesQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(expensesTable).orderBy(expensesTable.createdAt);
  if (q.data.branchId) rows = rows.filter(e => e.branchId === q.data.branchId);
  if (q.data.from) rows = rows.filter(e => e.createdAt.toISOString() >= q.data.from!);
  if (q.data.to) rows = rows.filter(e => e.createdAt.toISOString() <= q.data.to! + "T23:59:59Z");
  const users = await db.select().from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u.name]));
  res.json(ListExpensesResponse.parse(rows.map(e => mapExpense(e, e.loggedBy ? userMap.get(e.loggedBy) : null))));
});

router.post("/finance/expenses", async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [e] = await db.insert(expensesTable).values({ ...parsed.data, amountAed: String(parsed.data.amountAed) }).returning();
  res.status(201).json(CreateExpenseResponse.parse(mapExpense(e)));
});

router.delete("/finance/expenses/:id", async (req, res): Promise<void> => {
  const p = DeleteExpenseParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(expensesTable).where(eq(expensesTable.id, p.data.id));
  res.sendStatus(204);
});

router.get("/finance/summary", async (req, res): Promise<void> => {
  const q = GetFinanceSummaryQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let orders = await db.select().from(ordersTable);
  let expenses = await db.select().from(expensesTable);
  if (q.data.branchId) {
    orders = orders.filter(o => o.branchId === q.data.branchId);
    expenses = expenses.filter(e => e.branchId === q.data.branchId);
  }
  if (q.data.from) {
    orders = orders.filter(o => o.createdAt.toISOString() >= q.data.from!);
    expenses = expenses.filter(e => e.createdAt.toISOString() >= q.data.from!);
  }
  if (q.data.to) {
    const to = q.data.to + "T23:59:59Z";
    orders = orders.filter(o => o.createdAt.toISOString() <= to);
    expenses = expenses.filter(e => e.createdAt.toISOString() <= to);
  }
  const deliveredOrders = orders.filter(o => o.status === "delivered");
  const totalRevenue = deliveredOrders.reduce((acc, o) => acc + Number(o.totalAed), 0);
  const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amountAed), 0);
  res.json(GetFinanceSummaryResponse.parse({
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    orderCount: deliveredOrders.length,
    avgOrderValue: deliveredOrders.length > 0 ? totalRevenue / deliveredOrders.length : 0,
    branchId: q.data.branchId ?? null,
    from: q.data.from ?? null,
    to: q.data.to ?? null,
  }));
});

router.get("/finance/revenue-trend", async (req, res): Promise<void> => {
  const q = GetRevenueTrendQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const days = q.data.days ?? 30;
  let orders = await db.select().from(ordersTable);
  if (q.data.branchId) orders = orders.filter(o => o.branchId === q.data.branchId);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  orders = orders.filter(o => o.createdAt >= since && o.status === "delivered");

  const dateMap = new Map<string, { revenue: number; orderCount: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dateMap.set(key, { revenue: 0, orderCount: 0 });
  }
  for (const o of orders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    const entry = dateMap.get(key);
    if (entry) {
      entry.revenue += Number(o.totalAed);
      entry.orderCount += 1;
    }
  }
  const trend = Array.from(dateMap.entries()).map(([date, v]) => ({ date, ...v }));
  res.json(GetRevenueTrendResponse.parse(trend));
});

// ── FINANCE CLEANUP ───────────────────────────────────────────────────────────
// This operates on revenue and finance records only. Customer, menu, staff,
// branch, and other unrelated reference data are never part of this cleanup.
type CleanupRange = { from: Date; to: Date };

function parseCleanupRange(input: { from: string | Date; to: string | Date }): CleanupRange | string {
  const from = input.from instanceof Date ? input.from : new Date(input.from);
  const to = input.to instanceof Date ? input.to : new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "from and to must be valid date-time values";
  }
  if (from >= to) {
    return "from must be earlier than to";
  }
  return { from, to };
}

function inCleanupRange(createdAt: Date, range: CleanupRange): boolean {
  return createdAt >= range.from && createdAt <= range.to;
}

function totalAmount(rows: Array<{ amountAed: string | number }>): number {
  return rows.reduce((sum, row) => sum + Number(row.amountAed), 0);
}

function buildCleanupPreview(
  range: CleanupRange,
  financeEntries: Array<{ createdAt: Date; isLocked: boolean; amountAed: string }>,
  expenses: Array<{ createdAt: Date; amountAed: string }>,
  commissions: Array<{ createdAt: Date; amountAed: string; orderId: number }>,
  orders: Array<{ id: number; createdAt: Date; totalAed: string }>,
  orderItems: Array<{ orderId: number }>,
  orderStatusHistory: Array<{ orderId: number }>,
  deliveries: Array<{ orderId: number }>,
  lotteryEntries: Array<{ id: number; orderId: number }>,
  lotteryWinners: Array<{ entryId: number }>,
  whatsappMessages: Array<{ orderId: number | null }>,
) {
  const entriesInRange = financeEntries.filter((entry) => inCleanupRange(entry.createdAt, range));
  const expensesInRange = expenses.filter((expense) => inCleanupRange(expense.createdAt, range));
  const ordersInRange = orders.filter((order) => inCleanupRange(order.createdAt, range));
  const orderIds = new Set(ordersInRange.map((order) => order.id));
  const commissionsInRange = commissions.filter((commission) => inCleanupRange(commission.createdAt, range) || orderIds.has(commission.orderId));
  const lotteryEntryIds = new Set(lotteryEntries.filter((entry) => orderIds.has(entry.orderId)).map((entry) => entry.id));
  const relatedCount =
    orderItems.filter((row) => orderIds.has(row.orderId)).length +
    orderStatusHistory.filter((row) => orderIds.has(row.orderId)).length +
    deliveries.filter((row) => orderIds.has(row.orderId)).length +
    lotteryEntryIds.size +
    lotteryWinners.filter((row) => lotteryEntryIds.has(row.entryId)).length +
    whatsappMessages.filter((row) => row.orderId !== null && orderIds.has(row.orderId)).length;
  const financeEntriesSummary = {
    count: entriesInRange.length,
    totalAed: totalAmount(entriesInRange),
    lockedCount: entriesInRange.filter((entry) => entry.isLocked).length,
    lockedAmountAed: totalAmount(entriesInRange.filter((entry) => entry.isLocked)),
  };
  const expenseSummary = { count: expensesInRange.length, totalAed: totalAmount(expensesInRange) };
  const commissionSummary = { count: commissionsInRange.length, totalAed: totalAmount(commissionsInRange) };
  const revenueSummary = {
    count: ordersInRange.length,
    totalAed: totalAmount(ordersInRange.map((order) => ({ amountAed: order.totalAed }))),
    relatedCount,
  };

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    revenue: revenueSummary,
    financeEntries: financeEntriesSummary,
    expenses: expenseSummary,
    commissions: commissionSummary,
    totalCount: revenueSummary.count + revenueSummary.relatedCount + financeEntriesSummary.count + expenseSummary.count + commissionSummary.count,
    totalAmountAed: revenueSummary.totalAed + financeEntriesSummary.totalAed + expenseSummary.totalAed + commissionSummary.totalAed,
  };
}

router.get("/finance/cleanup/preview", async (req, res): Promise<void> => {
  const parsed = PreviewFinanceCleanupQueryParams.safeParse({
    from: new Date(String(req.query.from ?? "")),
    to: new Date(String(req.query.to ?? "")),
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const range = parseCleanupRange(parsed.data);
  if (typeof range === "string") {
    res.status(400).json({ error: range });
    return;
  }

  const [financeEntries, expenses, commissions, orders, orderItems, orderStatusHistory, deliveries, lotteryEntries, lotteryWinners, whatsappMessages] = await Promise.all([
    db.select({
      createdAt: financeEntriesTable.createdAt,
      isLocked: financeEntriesTable.isLocked,
      amountAed: financeEntriesTable.amountAed,
    }).from(financeEntriesTable),
    db.select({ createdAt: expensesTable.createdAt, amountAed: expensesTable.amountAed }).from(expensesTable),
    db.select({ createdAt: commissionsTable.createdAt, amountAed: commissionsTable.amountAed, orderId: commissionsTable.orderId }).from(commissionsTable),
    db.select({ id: ordersTable.id, createdAt: ordersTable.createdAt, totalAed: ordersTable.totalAed }).from(ordersTable),
    db.select({ orderId: orderItemsTable.orderId }).from(orderItemsTable),
    db.select({ orderId: orderStatusHistoryTable.orderId }).from(orderStatusHistoryTable),
    db.select({ orderId: deliveriesTable.orderId }).from(deliveriesTable),
    db.select({ id: lotteryEntriesTable.id, orderId: lotteryEntriesTable.orderId }).from(lotteryEntriesTable),
    db.select({ entryId: lotteryWinnersTable.entryId }).from(lotteryWinnersTable),
    db.select({ orderId: whatsappMessagesTable.orderId }).from(whatsappMessagesTable),
  ]);

  res.json(PreviewFinanceCleanupResponse.parse(buildCleanupPreview(
    range,
    financeEntries,
    expenses,
    commissions,
    orders,
    orderItems,
    orderStatusHistory,
    deliveries,
    lotteryEntries,
    lotteryWinners,
    whatsappMessages,
  )));
});

router.post("/finance/cleanup", async (req, res): Promise<void> => {
  const parsed = CleanupFinanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.confirm !== true) {
    res.status(400).json({ error: "Explicit confirmation is required before permanent deletion" });
    return;
  }
  const range = parseCleanupRange(parsed.data);
  if (typeof range === "string") {
    res.status(400).json({ error: range });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    const ordersToDelete = await tx.select({
      id: ordersTable.id,
      totalAed: ordersTable.totalAed,
    }).from(ordersTable).where(and(
      gte(ordersTable.createdAt, range.from),
      lte(ordersTable.createdAt, range.to),
    ));
    const orderIds = ordersToDelete.map((order) => order.id);
    const lotteryEntriesToDelete = orderIds.length > 0
      ? await tx.select({ id: lotteryEntriesTable.id })
        .from(lotteryEntriesTable)
        .where(inArray(lotteryEntriesTable.orderId, orderIds))
      : [];
    const lotteryEntryIds = lotteryEntriesToDelete.map((entry) => entry.id);

    const whatsappMessagesDeleted = orderIds.length > 0
      ? await tx.delete(whatsappMessagesTable)
        .where(inArray(whatsappMessagesTable.orderId, orderIds))
        .returning({ id: whatsappMessagesTable.id })
      : [];
    const lotteryWinnersDeleted = lotteryEntryIds.length > 0
      ? await tx.delete(lotteryWinnersTable)
        .where(inArray(lotteryWinnersTable.entryId, lotteryEntryIds))
        .returning({ id: lotteryWinnersTable.id })
      : [];
    const lotteryEntriesDeleted = lotteryEntryIds.length > 0
      ? await tx.delete(lotteryEntriesTable)
        .where(inArray(lotteryEntriesTable.id, lotteryEntryIds))
        .returning({ id: lotteryEntriesTable.id })
      : [];
    const commissionsCondition = orderIds.length > 0
      ? or(
        and(
          gte(commissionsTable.createdAt, range.from),
          lte(commissionsTable.createdAt, range.to),
        ),
        inArray(commissionsTable.orderId, orderIds),
      )
      : and(
        gte(commissionsTable.createdAt, range.from),
        lte(commissionsTable.createdAt, range.to),
      );
    const commissionsDeleted = await tx.delete(commissionsTable)
      .where(commissionsCondition)
      .returning({ amountAed: commissionsTable.amountAed });
    const orderStatusHistoryDeleted = orderIds.length > 0
      ? await tx.delete(orderStatusHistoryTable)
        .where(inArray(orderStatusHistoryTable.orderId, orderIds))
        .returning({ id: orderStatusHistoryTable.id })
      : [];
    const orderItemsDeleted = orderIds.length > 0
      ? await tx.delete(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, orderIds))
        .returning({ id: orderItemsTable.id })
      : [];
    const deliveriesDeleted = orderIds.length > 0
      ? await tx.delete(deliveriesTable)
        .where(inArray(deliveriesTable.orderId, orderIds))
        .returning({ id: deliveriesTable.id })
      : [];
    const ordersDeleted = orderIds.length > 0
      ? await tx.delete(ordersTable)
        .where(inArray(ordersTable.id, orderIds))
        .returning({ totalAed: ordersTable.totalAed })
      : [];
    const financeEntriesDeleted = await tx.delete(financeEntriesTable)
      .where(and(
        gte(financeEntriesTable.createdAt, range.from),
        lte(financeEntriesTable.createdAt, range.to),
      ))
      .returning({ amountAed: financeEntriesTable.amountAed, isLocked: financeEntriesTable.isLocked });
    const expensesDeleted = await tx.delete(expensesTable)
      .where(and(
        gte(expensesTable.createdAt, range.from),
        lte(expensesTable.createdAt, range.to),
      ))
      .returning({ amountAed: expensesTable.amountAed });
    const relatedCount = orderItemsDeleted.length +
      orderStatusHistoryDeleted.length +
      deliveriesDeleted.length +
      lotteryEntriesDeleted.length +
      lotteryWinnersDeleted.length +
      whatsappMessagesDeleted.length;

    return {
      revenue: {
        count: ordersDeleted.length,
        totalAed: ordersDeleted.reduce((sum, order) => sum + Number(order.totalAed), 0),
        relatedCount,
      },
      financeEntries: {
        count: financeEntriesDeleted.length,
        totalAed: totalAmount(financeEntriesDeleted),
        lockedCount: financeEntriesDeleted.filter((entry) => entry.isLocked).length,
        lockedAmountAed: totalAmount(financeEntriesDeleted.filter((entry) => entry.isLocked)),
      },
      expenses: { count: expensesDeleted.length, totalAed: totalAmount(expensesDeleted) },
      commissions: { count: commissionsDeleted.length, totalAed: totalAmount(commissionsDeleted) },
      totalCount: ordersDeleted.length + relatedCount + financeEntriesDeleted.length + expensesDeleted.length + commissionsDeleted.length,
      totalAmountAed: ordersDeleted.reduce((sum, order) => sum + Number(order.totalAed), 0) + totalAmount(financeEntriesDeleted) + totalAmount(expensesDeleted) + totalAmount(commissionsDeleted),
      lockedFinanceEntriesCount: financeEntriesDeleted.filter((entry) => entry.isLocked).length,
    };
  });

  const response = {
    ok: true,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    deleted: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      ...deleted,
    },
    lockedFinanceEntriesCount: deleted.lockedFinanceEntriesCount,
    deletedAt: new Date().toISOString(),
  };
  res.json(CleanupFinanceResponse.parse(response));
});

// ── COMMISSION RATES (PATCH — admin only, gate above applies) ───────────────

router.patch("/finance/commission-rates", async (req, res): Promise<void> => {
  const { chefCommissionPercent, deliveryCommissionPerOrder } = req.body;
  const updatedBy = req.user!.id;
  if (typeof chefCommissionPercent === "number" && chefCommissionPercent >= 0) {
    await db.insert(settingsTable).values({
      key: "chef_commission_percent",
      value: String(chefCommissionPercent),
      isSensitive: false,
      updatedByUserId: updatedBy,
    }).onConflictDoUpdate({ target: settingsTable.key, set: { value: String(chefCommissionPercent), updatedByUserId: updatedBy } });
  }
  if (typeof deliveryCommissionPerOrder === "number" && deliveryCommissionPerOrder >= 0) {
    await db.insert(settingsTable).values({
      key: "delivery_commission_per_order",
      value: String(deliveryCommissionPerOrder),
      isSensitive: false,
      updatedByUserId: updatedBy,
    }).onConflictDoUpdate({ target: settingsTable.key, set: { value: String(deliveryCommissionPerOrder), updatedByUserId: updatedBy } });
  }
  res.json({ ok: true });
});

// ── COMMISSION SUMMARY ───────────────────────────────────────────────────────

router.get("/finance/commissions", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(String(req.query.branchId), 10) : null;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  let rows = await db.select().from(commissionsTable).orderBy(commissionsTable.createdAt);
  const allUsers = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, branchId: usersTable.branchId }).from(usersTable);
  const userMap = new Map(allUsers.map(u => [u.id, u]));

  if (branchId) {
    rows = rows.filter(c => {
      const u = userMap.get(c.userId);
      return u?.branchId === branchId;
    });
  }
  if (from) rows = rows.filter(c => c.createdAt.toISOString() >= from);
  if (to) rows = rows.filter(c => c.createdAt.toISOString() <= to + "T23:59:59Z");

  const byUser = new Map<number, { userId: number; name: string; role: string; type: string; orderCount: number; totalAed: number }>();
  for (const c of rows) {
    if (!byUser.has(c.userId)) {
      const u = userMap.get(c.userId);
      byUser.set(c.userId, {
        userId: c.userId,
        name: u?.name ?? "Unknown",
        role: u?.role ?? "unknown",
        type: c.type,
        orderCount: 0,
        totalAed: 0,
      });
    }
    const entry = byUser.get(c.userId)!;
    entry.orderCount += 1;
    entry.totalAed += Number(c.amountAed);
  }

  const staffBreakdown = Array.from(byUser.values()).sort((a, b) => b.totalAed - a.totalAed);
  const totalChefCommissions = staffBreakdown.filter(s => s.type === "chef").reduce((a, s) => a + s.totalAed, 0);
  const totalDeliveryCommissions = staffBreakdown.filter(s => s.type === "delivery").reduce((a, s) => a + s.totalAed, 0);
  const totalCommissions = totalChefCommissions + totalDeliveryCommissions;

  const chefPercentSetting = await db.select().from(settingsTable).where(eq(settingsTable.key, "chef_commission_percent"));
  const deliveryRateSetting = await db.select().from(settingsTable).where(eq(settingsTable.key, "delivery_commission_per_order"));

  res.json({
    totalCommissions,
    totalChefCommissions,
    totalDeliveryCommissions,
    chefCommissionPercent: chefPercentSetting[0] ? parseFloat(chefPercentSetting[0].value) : 5,
    deliveryCommissionPerOrder: deliveryRateSetting[0] ? parseFloat(deliveryRateSetting[0].value) : 10,
    staffBreakdown,
    records: rows.map(c => ({
      id: c.id,
      userId: c.userId,
      userName: userMap.get(c.userId)?.name ?? "Unknown",
      orderId: c.orderId,
      amountAed: Number(c.amountAed),
      type: c.type,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

export default router;
