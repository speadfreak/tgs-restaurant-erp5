import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, deliveriesTable, ordersTable, customersTable, usersTable } from "@workspace/db";
import {
  ListDeliveriesQueryParams,
  ListDeliveriesResponse,
  CreateDeliveryBody,
  CreateDeliveryResponse,
  GetDeliveryParams,
  GetDeliveryResponse,
  UpdateDeliveryParams,
  UpdateDeliveryBody,
  UpdateDeliveryResponse,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES, DELIVERY_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use("/deliveries", authenticate, requireRole(...ADMIN_ROLES, ...DELIVERY_ROLES));

async function buildDelivery(d: typeof deliveriesTable.$inferSelect) {
  const order = (await db.select().from(ordersTable).where(eq(ordersTable.id, d.orderId)))[0];
  const customer = order?.customerId
    ? (await db.select().from(customersTable).where(eq(customersTable.id, order.customerId)))[0]
    : null;
  const staff = d.deliveryStaffId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, d.deliveryStaffId)))[0]
    : null;
  return {
    id: d.id,
    orderId: d.orderId,
    orderCode: order?.orderCode ?? null,
    deliveryStaffId: d.deliveryStaffId ?? null,
    staffName: staff?.name ?? null,
    pickedUpAt: d.pickedUpAt?.toISOString() ?? null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    deliveryStatus: d.deliveryStatus,
    amountCollected: d.amountCollected ? Number(d.amountCollected) : null,
    gpsLocation: d.gpsLocation ?? null,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phone ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/deliveries", async (req, res): Promise<void> => {
  const q = ListDeliveriesQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(deliveriesTable).orderBy(deliveriesTable.createdAt);
  if (q.data.staffId) rows = rows.filter(d => d.deliveryStaffId === q.data.staffId);
  if (q.data.status) rows = rows.filter(d => d.deliveryStatus === q.data.status);
  const results = await Promise.all(rows.slice(0, 50).map(buildDelivery));
  res.json(ListDeliveriesResponse.parse(results));
});

router.post("/deliveries", async (req, res): Promise<void> => {
  const parsed = CreateDeliveryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [d] = await db.insert(deliveriesTable).values(parsed.data).returning();
  res.status(201).json(CreateDeliveryResponse.parse(await buildDelivery(d)));
});

router.get("/deliveries/:id", async (req, res): Promise<void> => {
  const p = GetDeliveryParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [d] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, p.data.id));
  if (!d) { res.status(404).json({ error: "Delivery not found" }); return; }
  res.json(GetDeliveryResponse.parse(await buildDelivery(d)));
});

router.patch("/deliveries/:id", async (req, res): Promise<void> => {
  const p = UpdateDeliveryParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateDeliveryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.deliveryStatus === "picked_up") updateData.pickedUpAt = new Date();
  if (parsed.data.deliveryStatus === "delivered" || parsed.data.deliveryStatus === "failed") updateData.deliveredAt = new Date();
  const [d] = await db.update(deliveriesTable).set(updateData).where(eq(deliveriesTable.id, p.data.id)).returning();
  if (!d) { res.status(404).json({ error: "Delivery not found" }); return; }
  res.json(UpdateDeliveryResponse.parse(await buildDelivery(d)));
});

export default router;
