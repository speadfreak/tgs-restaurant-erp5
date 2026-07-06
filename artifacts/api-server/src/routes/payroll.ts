import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, timesheetsTable, payslipsTable, commissionsTable, usersTable } from "@workspace/db";
import {
  ListTimesheetsQueryParams,
  ListTimesheetsResponse,
  CreateTimesheetBody,
  CreateTimesheetResponse,
  UpdateTimesheetParams,
  UpdateTimesheetBody,
  UpdateTimesheetResponse,
  ListPayslipsQueryParams,
  ListPayslipsResponse,
  GeneratePayslipBody,
  GeneratePayslipResponse,
  ListCommissionsQueryParams,
  ListCommissionsResponse,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES));

function mapTimesheet(t: typeof timesheetsTable.$inferSelect, userName?: string | null) {
  const clockIn = t.clockIn.getTime();
  const clockOut = t.clockOut?.getTime();
  const hoursWorked = clockOut ? (clockOut - clockIn) / 3600000 : null;
  return {
    id: t.id,
    userId: t.userId,
    userName: userName ?? null,
    branchId: t.branchId,
    clockIn: t.clockIn.toISOString(),
    clockOut: t.clockOut?.toISOString() ?? null,
    hoursWorked,
  };
}

router.get("/payroll/timesheets", async (req, res): Promise<void> => {
  const q = ListTimesheetsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(timesheetsTable).orderBy(timesheetsTable.clockIn);
  if (q.data.userId) rows = rows.filter(t => t.userId === q.data.userId);
  if (q.data.branchId) rows = rows.filter(t => t.branchId === q.data.branchId);
  const users = await db.select().from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u.name]));
  res.json(ListTimesheetsResponse.parse(rows.map(t => mapTimesheet(t, userMap.get(t.userId)))));
});

router.post("/payroll/timesheets", async (req, res): Promise<void> => {
  const parsed = CreateTimesheetBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data: Record<string, unknown> = {
    userId: parsed.data.userId,
    branchId: parsed.data.branchId,
    clockIn: new Date(parsed.data.clockIn),
  };
  if (parsed.data.clockOut) data.clockOut = new Date(parsed.data.clockOut);
  const [t] = await db.insert(timesheetsTable).values(data as Parameters<typeof db.insert>[0] extends infer T ? any : never).returning();
  const user = (await db.select().from(usersTable).where(eq(usersTable.id, t.userId)))[0];
  res.status(201).json(CreateTimesheetResponse.parse(mapTimesheet(t, user?.name)));
});

router.patch("/payroll/timesheets/:id", async (req, res): Promise<void> => {
  const p = UpdateTimesheetParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateTimesheetBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.clockOut) updateData.clockOut = new Date(parsed.data.clockOut);
  const [t] = await db.update(timesheetsTable).set(updateData as any).where(eq(timesheetsTable.id, p.data.id)).returning();
  if (!t) { res.status(404).json({ error: "Timesheet not found" }); return; }
  const user = (await db.select().from(usersTable).where(eq(usersTable.id, t.userId)))[0];
  res.json(UpdateTimesheetResponse.parse(mapTimesheet(t, user?.name)));
});

router.get("/payroll/payslips", async (req, res): Promise<void> => {
  const q = ListPayslipsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(payslipsTable).orderBy(payslipsTable.generatedAt);
  if (q.data.userId) rows = rows.filter(p => p.userId === q.data.userId);
  const users = await db.select().from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u.name]));
  res.json(ListPayslipsResponse.parse(rows.map(p => ({
    id: p.id,
    userId: p.userId,
    userName: userMap.get(p.userId) ?? null,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    baseSalary: Number(p.baseSalary),
    commissionTotal: Number(p.commissionTotal),
    overtimeTotal: Number(p.overtimeTotal),
    deductions: Number(p.deductions),
    netPay: Number(p.netPay),
    generatedAt: p.generatedAt.toISOString(),
  }))));
});

router.post("/payroll/payslips", async (req, res): Promise<void> => {
  const parsed = GeneratePayslipBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const user = (await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.userId)))[0];
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const commissions = await db.select().from(commissionsTable).where(eq(commissionsTable.userId, parsed.data.userId));
  const commissionTotal = commissions.reduce((acc, c) => acc + Number(c.amountAed), 0);
  const baseSalary = user.baseSalary ? Number(user.baseSalary) : 0;
  const netPay = baseSalary + commissionTotal;
  const [payslip] = await db.insert(payslipsTable).values({
    userId: parsed.data.userId,
    periodStart: parsed.data.periodStart,
    periodEnd: parsed.data.periodEnd,
    baseSalary: String(baseSalary),
    commissionTotal: String(commissionTotal),
    overtimeTotal: "0",
    deductions: "0",
    netPay: String(netPay),
  }).returning();
  res.status(201).json(GeneratePayslipResponse.parse({
    id: payslip.id,
    userId: payslip.userId,
    userName: user.name,
    periodStart: payslip.periodStart,
    periodEnd: payslip.periodEnd,
    baseSalary: Number(payslip.baseSalary),
    commissionTotal: Number(payslip.commissionTotal),
    overtimeTotal: Number(payslip.overtimeTotal),
    deductions: Number(payslip.deductions),
    netPay: Number(payslip.netPay),
    generatedAt: payslip.generatedAt.toISOString(),
  }));
});

router.get("/payroll/commissions", async (req, res): Promise<void> => {
  const q = ListCommissionsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(commissionsTable).orderBy(commissionsTable.createdAt);
  if (q.data.userId) rows = rows.filter(c => c.userId === q.data.userId);
  res.json(ListCommissionsResponse.parse(rows.map(c => ({
    id: c.id,
    userId: c.userId,
    orderId: c.orderId,
    amountAed: Number(c.amountAed),
    type: c.type,
    createdAt: c.createdAt.toISOString(),
  }))));
});

export default router;
