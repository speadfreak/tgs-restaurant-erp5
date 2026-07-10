import { Router } from "express";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, ordersTable } from "@workspace/db";
import {
  ListUsersResponse,
  ListUsersQueryParams,
  CreateUserBody,
  CreateUserResponse,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use("/users", authenticate, requireRole(...ADMIN_ROLES));

function mapUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email ?? null,
    role: u.role,
    branchId: u.branchId ?? null,
    baseSalary: u.baseSalary ? Number(u.baseSalary) : null,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/users", async (req, res): Promise<void> => {
  const q = ListUsersQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(usersTable).orderBy(usersTable.id);
  if (q.data.branchId) rows = rows.filter(u => u.branchId === q.data.branchId);
  if (q.data.role) rows = rows.filter(u => u.role === q.data.role);
  res.json(ListUsersResponse.parse(rows.map(mapUser)));
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { password, ...rest } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  const [u] = await db.insert(usersTable).values({ ...rest, passwordHash, baseSalary: rest.baseSalary !== undefined ? String(rest.baseSalary) : undefined }).returning();
  res.status(201).json(CreateUserResponse.parse(mapUser(u)));
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const p = GetUserParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, p.data.id));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  res.json(GetUserResponse.parse(mapUser(u)));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const p = UpdateUserParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.baseSalary !== undefined && parsed.data.baseSalary !== null) updateData.baseSalary = String(parsed.data.baseSalary);
  // Support password change via PATCH (not in generated schema, handled separately)
  const rawPassword = (req.body as Record<string, unknown>).password;
  if (rawPassword !== undefined && rawPassword !== null && rawPassword !== "") {
    if (typeof rawPassword !== "string" || rawPassword.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" }); return;
    }
    updateData.passwordHash = await bcrypt.hash(rawPassword, 10);
    updateData.passwordChanged = false;
  }
  const [u] = await db.update(usersTable).set(updateData as any).where(eq(usersTable.id, p.data.id)).returning();
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  res.json(UpdateUserResponse.parse(mapUser(u)));
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const p = DeleteUserParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (p.data.id === req.user!.id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }
  await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, p.data.id));
  res.sendStatus(204);
});

router.get("/users/:id/performance", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (user.role === "kitchen_staff") {
    const allPrepared = await db.select().from(ordersTable).where(eq(ordersTable.acceptedByUserId, id));
    const thisMonth = allPrepared.filter(o => o.acceptedAt && o.acceptedAt >= monthStart);
    const prepTimes = allPrepared
      .filter(o => o.acceptedAt && o.markedReadyAt)
      .map(o => (o.markedReadyAt!.getTime() - o.acceptedAt!.getTime()) / 60000);
    const avgPrepTime = prepTimes.length ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length : 0;
    const activeOrders = allPrepared.filter(o => o.status === "preparing");

    res.json({
      role: "kitchen_staff",
      totalPreparedAllTime: allPrepared.length,
      totalPreparedThisMonth: thisMonth.length,
      avgPrepTimeMinutes: Math.round(avgPrepTime * 10) / 10,
      fastestPrepMinutes: prepTimes.length ? Math.round(Math.min(...prepTimes) * 10) / 10 : null,
      slowestPrepMinutes: prepTimes.length ? Math.round(Math.max(...prepTimes) * 10) / 10 : null,
      currentlyPreparing: activeOrders.length,
      chefStatus: user.chefStatus,
    });
    return;
  }

  if (user.role === "delivery_staff") {
    const allDelivered = await db.select().from(ordersTable).where(
      and(eq(ordersTable.assignedDeliveryUserId, id), eq(ordersTable.status, "delivered"))
    );
    const today = allDelivered.filter(o => o.updatedAt >= todayStart);
    const thisMonth = allDelivered.filter(o => o.updatedAt >= monthStart);
    const commissionRate = user.commissionRate ? Number(user.commissionRate) : 0;
    const totalCommission = allDelivered.reduce((s, o) => {
      const orderTotal = Number(o.totalAed);
      return s + (commissionRate > 1 ? commissionRate : orderTotal * commissionRate);
    }, 0);
    const monthCommission = thisMonth.reduce((s, o) => {
      const orderTotal = Number(o.totalAed);
      return s + (commissionRate > 1 ? commissionRate : orderTotal * commissionRate);
    }, 0);

    res.json({
      role: "delivery_staff",
      totalDeliveredAllTime: allDelivered.length,
      totalDeliveredToday: today.length,
      totalDeliveredThisMonth: thisMonth.length,
      totalCommissionAed: Math.round(totalCommission * 100) / 100,
      monthCommissionAed: Math.round(monthCommission * 100) / 100,
      commissionRate,
      currentStatus: user.currentStatus,
    });
    return;
  }

  res.json({ role: user.role, message: "Performance metrics not available for this role" });
});

router.post("/users/:id/reset-password", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const digits = Math.floor(1000 + Math.random() * 9000);
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const letter1 = letters[Math.floor(Math.random() * letters.length)];
  const letter2 = letters[Math.floor(Math.random() * letters.length)];
  const tempPassword = `TG@${digits}${letter1}${letter2}`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await db.update(usersTable).set({ passwordHash, passwordChanged: false }).where(eq(usersTable.id, id));
  res.json({ ok: true, tempPassword });
});

export default router;
