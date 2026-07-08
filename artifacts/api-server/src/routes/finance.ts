import { Router } from "express";
import { eq, and, gte } from "drizzle-orm";
import { db, expensesTable, ordersTable, commissionsTable, usersTable, settingsTable, financeEntriesTable, branchesTable } from "@workspace/db";
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
  const rateKey = role === "kitchen_staff" ? "chef_commission_per_order" : "delivery_commission_per_order";
  const [rateSetting] = await db.select().from(settingsTable).where(eq(settingsTable.key, rateKey));
  const ratePerOrder = rateSetting ? parseFloat(rateSetting.value) : (role === "kitchen_staff" ? 5 : 10);

  res.json({
    userId,
    name: req.user!.name,
    role,
    type: role === "kitchen_staff" ? "chef" : "delivery",
    totalAed,
    orderCount,
    avgPerOrder: orderCount > 0 ? totalAed / orderCount : 0,
    ratePerOrder,
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
  const id = parseInt(req.params.id, 10);
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
  res.json({ id: updated.id, ...updated, amountAed: Number(updated.amountAed) });
});

router.delete("/finance/entries/:id", authenticate, requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
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

// ── ADMIN-ONLY MIDDLEWARE ────────────────────────────────────────────────────
router.use(authenticate, requireRole(...ADMIN_ROLES));

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

// ── COMMISSION RATES ────────────────────────────────────────────────────────

router.get("/finance/commission-rates", async (_req, res): Promise<void> => {
  const settings = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, "chef_commission_per_order"));
  const delivery = await db.select().from(settingsTable)
    .where(eq(settingsTable.key, "delivery_commission_per_order"));
  res.json({
    chefCommissionPerOrder: settings[0] ? parseFloat(settings[0].value) : 5,
    deliveryCommissionPerOrder: delivery[0] ? parseFloat(delivery[0].value) : 10,
  });
});

router.patch("/finance/commission-rates", async (req, res): Promise<void> => {
  const { chefCommissionPerOrder, deliveryCommissionPerOrder } = req.body;
  const updatedBy = req.user!.id;
  if (typeof chefCommissionPerOrder === "number" && chefCommissionPerOrder >= 0) {
    await db.insert(settingsTable).values({
      key: "chef_commission_per_order",
      value: String(chefCommissionPerOrder),
      isSensitive: false,
      updatedByUserId: updatedBy,
    }).onConflictDoUpdate({ target: settingsTable.key, set: { value: String(chefCommissionPerOrder), updatedByUserId: updatedBy } });
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

  const chefRateSetting = await db.select().from(settingsTable).where(eq(settingsTable.key, "chef_commission_per_order"));
  const deliveryRateSetting = await db.select().from(settingsTable).where(eq(settingsTable.key, "delivery_commission_per_order"));

  res.json({
    totalCommissions,
    totalChefCommissions,
    totalDeliveryCommissions,
    chefCommissionPerOrder: chefRateSetting[0] ? parseFloat(chefRateSetting[0].value) : 5,
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
