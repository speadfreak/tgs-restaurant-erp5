import { Router } from "express";
import { eq, count, sum } from "drizzle-orm";
import { db, customersTable, ordersTable } from "@workspace/db";
import {
  ListCustomersQueryParams,
  ListCustomersResponse,
  CreateCustomerBody,
  CreateCustomerResponse,
  GetCustomerParams,
  GetCustomerResponse,
  UpdateCustomerParams,
  UpdateCustomerBody,
  UpdateCustomerResponse,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES, ORDER_INTAKE_ROLES, DELIVERY_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES, ...ORDER_INTAKE_ROLES, ...DELIVERY_ROLES));

async function buildCustomer(c: typeof customersTable.$inferSelect) {
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.customerId, c.id));
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((acc, o) => acc + Number(o.totalAed), 0);
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    whatsappId: c.whatsappId ?? null,
    address: c.address ?? null,
    totalOrders,
    totalSpent,
    createdAt: c.createdAt.toISOString(),
  };
}

router.get("/customers", async (req, res): Promise<void> => {
  const q = ListCustomersQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(customersTable).orderBy(customersTable.createdAt);
  if (q.data.search) {
    const s = q.data.search.toLowerCase();
    rows = rows.filter(c => c.name.toLowerCase().includes(s) || c.phone.includes(s));
  }
  const results = await Promise.all(rows.slice(0, 100).map(buildCustomer));
  res.json(ListCustomersResponse.parse(results));
});

router.post("/customers", async (req, res): Promise<void> => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [c] = await db.insert(customersTable).values(parsed.data).returning();
  res.status(201).json(CreateCustomerResponse.parse(await buildCustomer(c)));
});

router.get("/customers/:id", async (req, res): Promise<void> => {
  const p = GetCustomerParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [c] = await db.select().from(customersTable).where(eq(customersTable.id, p.data.id));
  if (!c) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(GetCustomerResponse.parse(await buildCustomer(c)));
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const p = UpdateCustomerParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateCustomerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [c] = await db.update(customersTable).set(parsed.data).where(eq(customersTable.id, p.data.id)).returning();
  if (!c) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(UpdateCustomerResponse.parse(await buildCustomer(c)));
});

export default router;
