import { Router } from "express";
import { eq, and, gte, count } from "drizzle-orm";
import { db, usersTable, loginAttemptsTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import bcrypt from "bcryptjs";
import { signToken, verifyTokenIgnoreExpiry, authenticate } from "../middlewares/auth";

const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 30;

const router: Router = Router();

function userToPublic(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email ?? null,
    role: user.role,
    branchId: user.branchId ?? null,
    baseSalary: user.baseSalary ? Number(user.baseSalary) : null,
    active: user.active,
    passwordChanged: user.passwordChanged,
    chefStatus: user.chefStatus,
    currentStatus: user.currentStatus,
    commissionRate: user.commissionRate ? Number(user.commissionRate) : null,
    createdAt: user.createdAt.toISOString(),
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { phone, password } = parsed.data;
  const ip = String(
    (Array.isArray(req.headers["x-forwarded-for"])
      ? req.headers["x-forwarded-for"][0]
      : req.headers["x-forwarded-for"]) ??
      req.socket?.remoteAddress ??
      "unknown",
  );

  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000);
  const [{ value: failCount }] = await db
    .select({ value: count() })
    .from(loginAttemptsTable)
    .where(
      and(
        eq(loginAttemptsTable.phone, phone),
        eq(loginAttemptsTable.success, false),
        gte(loginAttemptsTable.attemptedAt, windowStart),
      ),
    );

  if (failCount >= MAX_ATTEMPTS) {
    res.status(429).json({
      error: `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.`,
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));

  if (!user || !user.active) {
    await db.insert(loginAttemptsTable).values({ phone, userId: user?.id ?? null, ipAddress: ip, success: false });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await db.insert(loginAttemptsTable).values({ phone, userId: user.id, ipAddress: ip, success: false });
    const remaining = MAX_ATTEMPTS - Number(failCount) - 1;
    if (remaining <= 0) {
      res.status(429).json({ error: `Account locked after too many failed attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.` });
    } else {
      res.status(401).json({ error: `Invalid credentials. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` });
    }
    return;
  }

  await db.insert(loginAttemptsTable).values({ phone, userId: user.id, ipAddress: ip, success: true });

  const token = signToken({ id: user.id, role: user.role, branchId: user.branchId ?? null, name: user.name, email: user.email ?? null });
  res.json({ token, user: userToPublic(user) });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ ok: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyTokenIgnoreExpiry(auth.slice(7));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.id));
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(userToPublic(user));
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyTokenIgnoreExpiry(auth.slice(7));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.id));
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    const token = signToken({ id: user.id, role: user.role, branchId: user.branchId ?? null, name: user.name, email: user.email ?? null });
    res.json({ token, user: userToPublic(user) });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

router.post("/auth/change-password", authenticate, async (req, res): Promise<void> => {
  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    res.status(400).json({ error: "Password must contain at least one letter and one number" });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash, passwordChanged: true }).where(eq(usersTable.id, req.user!.id));
  res.json({ ok: true });
});

router.get("/auth/login-attempts", authenticate, async (req, res): Promise<void> => {
  if (req.user?.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const phone = typeof req.query.phone === "string" ? req.query.phone : null;
  const rows = phone
    ? await db.select().from(loginAttemptsTable).where(eq(loginAttemptsTable.phone, phone))
    : await db.select().from(loginAttemptsTable);
  res.json(rows.slice(-200).reverse());
});

router.post("/auth/unlock/:phone", authenticate, async (req, res): Promise<void> => {
  if (req.user?.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const phone = String(req.params.phone);
  await db.update(loginAttemptsTable).set({ success: true }).where(eq(loginAttemptsTable.phone, phone));
  res.json({ ok: true, message: `Login attempts cleared for ${phone}` });
});

export default router;
