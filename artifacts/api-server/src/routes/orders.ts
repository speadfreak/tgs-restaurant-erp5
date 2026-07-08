import { Router } from "express";
import { eq, desc, and, or } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, customersTable, branchesTable, menuItemsTable, orderStatusHistoryTable, usersTable, lotteryEntriesTable, lotterySettingsTable, commissionsTable, settingsTable, deliveriesTable } from "@workspace/db";
import { sendTeamsNotification } from "../lib/teams";
import { sendWhatsAppMessage } from "../lib/twilio";
import {
  ListOrdersQueryParams,
  ListOrdersResponse,
  CreateOrderBody,
  CreateOrderResponse,
  GetOrderParams,
  GetOrderResponse,
  UpdateOrderParams,
  UpdateOrderBody,
  UpdateOrderResponse,
  UpdateOrderStatusParams,
  UpdateOrderStatusBody,
  UpdateOrderStatusResponse,
  GetOrderByCodeParams,
  GetKitchenQueueQueryParams,
  GetKitchenQueueResponse,
  StartPreparingOrderParams,
  StartPreparingOrderResponse,
  MarkOrderReadyParams,
  MarkOrderReadyResponse,
} from "@workspace/api-zod";
import { getIO } from "../lib/socket";
import { authenticate, authenticateOptional, requireRole, ADMIN_ROLES, KITCHEN_ROLES, DELIVERY_ROLES, ORDER_INTAKE_ROLES } from "../middlewares/auth";

const router: Router = Router();

function genOrderCode() {
  const prefix = "TG";
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${ts}${rand}`;
}

async function buildOrderResponse(order: typeof ordersTable.$inferSelect) {
  const [items, customer, branch, relayedBy, assignedTo, delivery, lotteryEntry] = await Promise.all([
    db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)),
    order.customerId ? db.select().from(customersTable).where(eq(customersTable.id, order.customerId)).then(r => r[0] ?? null) : null,
    db.select().from(branchesTable).where(eq(branchesTable.id, order.branchId)).then(r => r[0] ?? null),
    order.relayedByUserId ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.relayedByUserId)).then(r => r[0] ?? null) : null,
    order.assignedDeliveryUserId ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, order.assignedDeliveryUserId)).then(r => r[0] ?? null) : null,
    db.select().from(deliveriesTable).where(eq(deliveriesTable.orderId, order.id)).then(r => r[0] ?? null),
    db.select({ luckyNumber: lotteryEntriesTable.luckyNumber }).from(lotteryEntriesTable).where(eq(lotteryEntriesTable.orderId, order.id)).then(r => r[0] ?? null),
  ]);

  const nameMap = new Map<number, { nameEn: string; priceAed: string }>();
  for (const mi of await db.select().from(menuItemsTable)) {
    nameMap.set(mi.id, { nameEn: mi.nameEn, priceAed: String(mi.priceAed) });
  }

  return {
    id: order.id,
    orderCode: order.orderCode,
    branchId: order.branchId,
    branchName: branch?.name ?? null,
    customerId: order.customerId ?? null,
    customerName: order.customerNameDirect ?? customer?.name ?? null,
    customerPhone: order.customerPhoneDirect ?? customer?.phone ?? null,
    deliveryAddress: order.deliveryAddress ?? customer?.address ?? null,
    channel: order.channel,
    status: order.status,
    totalAed: Number(order.totalAed),
    paymentMethod: order.paymentMethod ?? null,
    relayedByUserId: order.relayedByUserId ?? null,
    relayedByName: relayedBy?.name ?? null,
    assignedDeliveryUserId: order.assignedDeliveryUserId ?? null,
    assignedDeliveryName: assignedTo?.name ?? null,
    acceptedByUserId: order.acceptedByUserId ?? null,
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
    markedReadyAt: order.markedReadyAt?.toISOString() ?? null,
    claimedAt: order.claimedAt?.toISOString() ?? null,
    pickedUpAt: delivery?.pickedUpAt?.toISOString() ?? null,
    deliveredAt: delivery?.deliveredAt?.toISOString() ?? null,
    luckyNumber: lotteryEntry?.luckyNumber ?? null,
    items: items.map(i => ({
      id: i.id,
      menuItemId: i.menuItemId,
      menuItemName: nameMap.get(i.menuItemId)?.nameEn ?? null,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      notes: i.notes ?? null,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function tryEmit(event: string, data: unknown) {
  try { getIO().emit(event, data); } catch { /* socket not initialized */ }
}
function tryEmitTo(room: string, event: string, data: unknown) {
  try { getIO().to(room).emit(event, data); } catch { /* socket not initialized */ }
}

router.get("/orders", authenticate, requireRole(...ADMIN_ROLES, ...ORDER_INTAKE_ROLES), async (req, res): Promise<void> => {
  const q = ListOrdersQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  if (q.data.branchId) rows = rows.filter(o => o.branchId === q.data.branchId);
  if (q.data.status) rows = rows.filter(o => o.status === q.data.status);
  if (q.data.date) rows = rows.filter(o => o.createdAt.toISOString().startsWith(q.data.date!));
  const results = await Promise.all(rows.slice(0, 50).map(buildOrderResponse));
  res.json(results); // bypass strict Zod parse — pending_acceptance is a valid DB status
});

router.post("/orders", authenticateOptional, async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Reject walk-in channel — delivery-only restaurant
  if ((parsed.data as Record<string, unknown>).channel === "walk_in") {
    res.status(400).json({ error: "Walk-in orders are not supported. This is a delivery-only restaurant." });
    return;
  }

  const { items, ...orderData } = parsed.data;
  const orderCode = genOrderCode();
  let totalAed = 0;
  for (const item of items) { totalAed += item.quantity * item.unitPrice; }

  // Identity-aware: relayedByUserId ALWAYS comes from the verified JWT, never from the request body.
  const relayedByUserId =
    req.user && ["delivery_staff", "super_admin", "branch_manager", "order_staff"].includes(req.user.role)
      ? req.user.id
      : null;
  const deliveryAddress = typeof req.body.deliveryAddress === "string" ? req.body.deliveryAddress : null;
  const customerNameDirect = typeof req.body.customerNameDirect === "string" ? req.body.customerNameDirect : null;
  const customerPhoneDirect = typeof req.body.customerPhoneDirect === "string" ? req.body.customerPhoneDirect : null;

  const [order] = await db.insert(ordersTable).values({
    ...orderData,
    orderCode,
    totalAed: String(totalAed),
    channel: relayedByUserId ? "whatsapp_relay" : (orderData.channel ?? "webapp"),
    status: "pending_acceptance",
    relayedByUserId,
    deliveryAddress,
    customerNameDirect,
    customerPhoneDirect,
  }).returning();

  for (const item of items) {
    await db.insert(orderItemsTable).values({ ...item, orderId: order.id, unitPrice: String(item.unitPrice) });
  }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "pending_acceptance", changedBy: relayedByUserId ?? null });

  const result = await buildOrderResponse(order);

  // Real-time: notify kitchen
  tryEmitTo(`branch:${order.branchId}:kitchen`, "order:new", result);
  tryEmitTo(`branch:${order.branchId}:admin`, "order:new", result);

  // Lottery: generate lucky number immediately on order creation (no Twilio — admin copies manually)
  try {
    const phone = order.customerPhoneDirect ?? null;
    if (phone) {
      const today = new Date().toISOString().split("T")[0];
      let luckyNumber = 0;
      let attempts = 0;
      do {
        luckyNumber = Math.floor(100000 + Math.random() * 900000);
        const existing = await db.select({ id: lotteryEntriesTable.id })
          .from(lotteryEntriesTable)
          .where(and(
            eq(lotteryEntriesTable.branchId, order.branchId),
            eq(lotteryEntriesTable.drawDate, today),
            eq(lotteryEntriesTable.luckyNumber, luckyNumber)
          ));
        if (!existing.length) break;
        attempts++;
      } while (attempts < 10);

      // Safety: if still duplicate after 10 attempts, skip entry rather than insert a duplicate
      if (attempts >= 10) {
        console.warn(`[Lottery] Could not generate unique lucky number for order ${order.id} after 10 attempts — skipping`);
      } else {
        const [entry] = await db.insert(lotteryEntriesTable).values({
          branchId: order.branchId,
          orderId: order.id,
          customerPhone: phone,
          customerName: order.customerNameDirect ?? null,
          luckyNumber,
          drawDate: today,
          luckyNumberSent: false,
        }).returning();

        // Notify admin lottery panel in real time — no Twilio send
        tryEmitTo(`branch:${order.branchId}:admin`, "lottery:new_entry", {
          id: entry.id,
          orderId: order.id,
          orderCode: order.orderCode,
          branchId: order.branchId,
          customerName: order.customerNameDirect ?? null,
          customerPhone: phone,
          luckyNumber,
          drawDate: today,
          manuallySent: false,
          createdAt: entry.createdAt.toISOString(),
        });
      }
    }
  } catch (lotteryErr) {
    console.error("[Lottery trigger error]", lotteryErr);
  }

  res.status(201).json(result); // skip strict Zod parse — pending_acceptance is valid but not in generated enum
});

router.get("/orders/by-code/:code", async (req, res): Promise<void> => {
  const p = GetOrderByCodeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.orderCode, p.data.code));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(await buildOrderResponse(order));
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const p = GetOrderParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, p.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(GetOrderResponse.parse(await buildOrderResponse(order)));
});

router.patch("/orders/:id", authenticate, requireRole(...ADMIN_ROLES, ...ORDER_INTAKE_ROLES), async (req, res): Promise<void> => {
  const p = UpdateOrderParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [order] = await db.update(ordersTable).set(parsed.data).where(eq(ordersTable.id, p.data.id)).returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(UpdateOrderResponse.parse(await buildOrderResponse(order)));
});

router.patch("/orders/:id/status", authenticate, requireRole(...ADMIN_ROLES, ...ORDER_INTAKE_ROLES, ...KITCHEN_ROLES, ...DELIVERY_ROLES), async (req, res): Promise<void> => {
  const p = UpdateOrderStatusParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [order] = await db.update(ordersTable).set({ status: parsed.data.status }).where(eq(ordersTable.id, p.data.id)).returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: order.status });
  const result = await buildOrderResponse(order);
  tryEmitTo(`branch:${order.branchId}`, "order:status", { orderId: order.id, status: order.status, orderCode: order.orderCode, branchId: order.branchId });
  res.json(UpdateOrderStatusResponse.parse(result));
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDER HISTORY / ACTIVITY TIMELINE
// ─────────────────────────────────────────────────────────────────────────────

router.get("/orders/:id/history", authenticate, requireRole(...ADMIN_ROLES, ...ORDER_INTAKE_ROLES, ...KITCHEN_ROLES, ...DELIVERY_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const history = await db.select().from(orderStatusHistoryTable).where(eq(orderStatusHistoryTable.orderId, id)).orderBy(orderStatusHistoryTable.changedAt);
  const enriched = await Promise.all(history.map(async h => {
    const user = h.changedBy ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, h.changedBy)))[0] : null;
    return { ...h, changedAt: h.changedAt.toISOString(), changedByName: user?.name ?? null };
  }));
  res.json(enriched);
});

// ─────────────────────────────────────────────────────────────────────────────
// KITCHEN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/kitchen/queue", authenticate, requireRole(...KITCHEN_ROLES), async (req, res): Promise<void> => {
  const q = GetKitchenQueueQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  // Kitchen staff are locked to their own branch (ignore any client-supplied branchId).
  // Admin/branch-manager roles may pass a branchId query param to inspect other branches.
  const isKitchenStaff = req.user?.role === "kitchen_staff";
  const effectiveBranchId = isKitchenStaff
    ? req.user?.branchId ?? null
    : (q.data.branchId ?? req.user?.branchId ?? null);
  const activeStatuses = ["pending", "confirmed", "preparing", "pending_acceptance"];
  let rows = await db.select().from(ordersTable).orderBy(ordersTable.createdAt);
  rows = rows.filter(o => activeStatuses.includes(o.status));
  if (effectiveBranchId) rows = rows.filter(o => o.branchId === effectiveBranchId);

  const nameMap = new Map<number, string>();
  for (const mi of await db.select().from(menuItemsTable)) {
    nameMap.set(mi.id, mi.nameEn);
  }

  const tickets = await Promise.all(rows.slice(0, 30).map(async (order) => {
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    const customer = order.customerId
      ? (await db.select().from(customersTable).where(eq(customersTable.id, order.customerId)))[0]
      : null;
    const elapsedMinutes = Math.floor((Date.now() - order.createdAt.getTime()) / 60000);
    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      channel: order.channel,
      elapsedMinutes,
      customerName: order.customerNameDirect ?? customer?.name ?? null,
      deliveryAddress: order.deliveryAddress ?? customer?.address ?? null,
      relayedByUserId: order.relayedByUserId ?? null,
      notes: null,
      items: items.map(i => ({
        id: i.id,
        menuItemId: i.menuItemId,
        menuItemName: nameMap.get(i.menuItemId) ?? null,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        notes: i.notes ?? null,
      })),
      createdAt: order.createdAt.toISOString(),
    };
  }));
  res.json(GetKitchenQueueResponse.parse(tickets));
});

router.patch("/kitchen/orders/:id/start", authenticate, requireRole(...KITCHEN_ROLES), async (req, res): Promise<void> => {
  const p = StartPreparingOrderParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const acceptedByUserId = req.user!.id;
  const [order] = await db.update(ordersTable).set({
    status: "preparing",
    acceptedByUserId,
    acceptedAt: new Date(),
  }).where(eq(ordersTable.id, p.data.id)).returning();
  // Phase 5: update chef status to "preparing"
  if (acceptedByUserId) {
    await db.update(usersTable).set({ chefStatus: "preparing" }).where(eq(usersTable.id, acceptedByUserId));
  }
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "preparing", changedBy: acceptedByUserId });

  // Commission: credit chef for accepting this order
  try {
    const [rateSetting] = await db.select().from(settingsTable).where(eq(settingsTable.key, "chef_commission_per_order"));
    const rate = rateSetting ? parseFloat(rateSetting.value) : 5;
    if (rate > 0) {
      await db.insert(commissionsTable).values({ userId: acceptedByUserId, orderId: order.id, amountAed: String(rate), type: "chef" });
    }
  } catch { /* ignore commission errors */ }

  const result = await buildOrderResponse(order);
  tryEmitTo(`branch:${order.branchId}`, "order:status", { orderId: order.id, status: "preparing", orderCode: order.orderCode, branchId: order.branchId });
  if (order.relayedByUserId) tryEmitTo(`user:${order.relayedByUserId}`, "order:accepted", result);
  res.json(StartPreparingOrderResponse.parse(result));
});

router.patch("/kitchen/orders/:id/ready", authenticate, requireRole(...KITCHEN_ROLES), async (req, res): Promise<void> => {
  const p = MarkOrderReadyParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const markedByUserId = req.user!.id;
  const [order] = await db.update(ordersTable).set({ status: "ready", markedReadyByUserId: markedByUserId, markedReadyAt: new Date() }).where(eq(ordersTable.id, p.data.id)).returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "ready", changedBy: markedByUserId });
  // Phase 5: set chef back to "available" if they have no other orders in "preparing" state
  if (markedByUserId) {
    const stillPreparing = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(eq(ordersTable.acceptedByUserId, markedByUserId), eq(ordersTable.status, "preparing")));
    if (!stillPreparing.length) {
      await db.update(usersTable).set({ chefStatus: "available" }).where(eq(usersTable.id, markedByUserId));
    }
  }
  const result = await buildOrderResponse(order);
  // Notify all delivery staff in branch — both pool and (if relayed) the specific person
  tryEmitTo(`branch:${order.branchId}:delivery`, "order:ready_pool", result);
  if (order.relayedByUserId) {
    tryEmitTo(`user:${order.relayedByUserId}`, "order:ready", result);
  }
  tryEmitTo(`branch:${order.branchId}:admin`, "order:status", { orderId: order.id, status: "ready", orderCode: order.orderCode, branchId: order.branchId });
  res.json(MarkOrderReadyResponse.parse(result));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY PORTAL ROUTES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/delivery/queue", authenticate, requireRole(...DELIVERY_ROLES), async (req, res): Promise<void> => {
  // Fall back to the authenticated user's own branch when no branchId query param is given
  const queryBranchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const branchId = queryBranchId ?? req.user?.branchId ?? null;
  const includeHistory = req.query.includeHistory === "true";

  const activeStatuses = ["ready", "assigned", "out_for_delivery"];
  const allStatuses = [...activeStatuses, "delivered", "failed"];

  let rows = await db.select().from(ordersTable).orderBy(desc(ordersTable.updatedAt));
  rows = rows.filter(o => (includeHistory ? allStatuses : activeStatuses).includes(o.status));
  if (branchId) rows = rows.filter(o => o.branchId === branchId);

  const nameMap = new Map<number, string>();
  for (const mi of await db.select().from(menuItemsTable)) nameMap.set(mi.id, mi.nameEn);
  const allUsers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(allUsers.map(u => [u.id, u.name]));

  const sliced = rows.slice(0, 100);
  const orderIds = sliced.map(o => o.id);

  // Batch-fetch all items and lottery entries for the returned order set
  const [allItems, allLotteryEntries] = await Promise.all([
    orderIds.length ? db.select().from(orderItemsTable) : Promise.resolve([]),
    orderIds.length ? db.select({ orderId: lotteryEntriesTable.orderId, luckyNumber: lotteryEntriesTable.luckyNumber }).from(lotteryEntriesTable) : Promise.resolve([]),
  ]);
  const itemsByOrder = new Map<number, typeof allItems>();
  for (const i of allItems) {
    if (!itemsByOrder.has(i.orderId)) itemsByOrder.set(i.orderId, []);
    itemsByOrder.get(i.orderId)!.push(i);
  }
  const luckyByOrder = new Map(allLotteryEntries.filter(e => e.luckyNumber !== null).map(e => [e.orderId, e.luckyNumber]));

  const enriched = await Promise.all(sliced.map(async (order) => {
    const items = itemsByOrder.get(order.id) ?? [];
    const customer = order.customerId
      ? (await db.select().from(customersTable).where(eq(customersTable.id, order.customerId)))[0]
      : null;
    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      channel: order.channel,
      customerName: order.customerNameDirect ?? customer?.name ?? null,
      customerPhone: order.customerPhoneDirect ?? customer?.phone ?? null,
      deliveryAddress: order.deliveryAddress ?? customer?.address ?? null,
      relayedByUserId: order.relayedByUserId ?? null,
      assignedDeliveryUserId: order.assignedDeliveryUserId ?? null,
      staffName: order.assignedDeliveryUserId ? (userMap.get(order.assignedDeliveryUserId) ?? null) : null,
      claimedAt: order.claimedAt?.toISOString() ?? null,
      markedReadyAt: order.markedReadyAt?.toISOString() ?? null,
      luckyNumber: luckyByOrder.get(order.id) ?? null,
      items: items.map(i => ({ menuItemName: nameMap.get(i.menuItemId) ?? null, quantity: i.quantity })),
      totalAed: Number(order.totalAed),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }));
  res.json(enriched);
});

router.post("/delivery/orders/:id/claim", authenticate, requireRole(...DELIVERY_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.user!.id;

  // Atomic: only claim if still unclaimed
  const [current] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!current) { res.status(404).json({ error: "Order not found" }); return; }
  if (current.assignedDeliveryUserId && current.assignedDeliveryUserId !== userId) {
    res.status(409).json({ error: "Order already claimed by another rider" }); return;
  }

  const [order] = await db.update(ordersTable).set({
    assignedDeliveryUserId: userId,
    status: "assigned",
    claimedAt: new Date(),
  }).where(and(eq(ordersTable.id, id), eq(ordersTable.status, "ready"))).returning();

  if (!order) { res.status(409).json({ error: "Order no longer available" }); return; }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "assigned", changedBy: userId });
  const result = await buildOrderResponse(order);
  tryEmitTo(`branch:${order.branchId}:delivery`, "order:claimed", { orderId: order.id, claimedByUserId: userId });
  tryEmitTo(`branch:${order.branchId}:admin`, "order:status", { orderId: order.id, status: "assigned", orderCode: order.orderCode, branchId: order.branchId });
  res.json(result);
});

router.post("/delivery/orders/:id/pickup", authenticate, requireRole(...DELIVERY_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.user!.id;
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);

  // Ownership check: only the assigned rider (or admin) may mark pickup
  const [current] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!current) { res.status(404).json({ error: "Order not found" }); return; }
  if (!isAdmin && current.assignedDeliveryUserId !== userId) {
    res.status(403).json({ error: "Not your order" }); return;
  }

  const [order] = await db.update(ordersTable)
    .set({ status: "out_for_delivery" })
    .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "assigned")))
    .returning();
  if (!order) { res.status(409).json({ error: "Order is not in assigned state" }); return; }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: "out_for_delivery", changedBy: userId });
  tryEmitTo(`branch:${order.branchId}:admin`, "order:status", { orderId: order.id, status: "out_for_delivery", orderCode: order.orderCode, branchId: order.branchId });
  res.json(await buildOrderResponse(order));
});

router.post("/delivery/orders/:id/complete", authenticate, requireRole(...DELIVERY_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.user!.id;
  const isAdmin = ADMIN_ROLES.includes(req.user!.role);

  // Ownership check: only the assigned rider (or admin) may complete/fail
  const [current] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!current) { res.status(404).json({ error: "Order not found" }); return; }
  if (!isAdmin && current.assignedDeliveryUserId !== userId) {
    res.status(403).json({ error: "Not your order" }); return;
  }

  const outcome = req.body.outcome === "failed" ? "failed" : "delivered";
  const [order] = await db.update(ordersTable)
    .set({ status: outcome })
    .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "out_for_delivery")))
    .returning();
  if (!order) { res.status(409).json({ error: "Order is not out for delivery" }); return; }
  await db.insert(orderStatusHistoryTable).values({ orderId: order.id, status: outcome, changedBy: userId });
  // Commission: credit delivery staff when order is successfully delivered
  if (outcome === "delivered") {
    try {
      const [rateSetting] = await db.select().from(settingsTable).where(eq(settingsTable.key, "delivery_commission_per_order"));
      const rate = rateSetting ? parseFloat(rateSetting.value) : 10;
      if (rate > 0) {
        await db.insert(commissionsTable).values({ userId, orderId: order.id, amountAed: String(rate), type: "delivery" });
      }
    } catch { /* ignore commission errors */ }
  }
  tryEmitTo(`branch:${order.branchId}:admin`, "order:status", { orderId: order.id, status: outcome, orderCode: order.orderCode, branchId: order.branchId });
  tryEmitTo(`order:${order.orderCode}`, "order:status_public", { status: outcome });
  if (outcome === "delivered") {
    const custName = order.customerNameDirect ?? `Customer #${order.customerId}`;
    sendTeamsNotification(
      `✅ Order Delivered — ${order.orderCode}`,
      `${custName} · ${Number(order.totalAed).toFixed(2)} AED · Delivered by ${req.user!.name}`,
    ).catch(() => { /* non-critical */ });
  }
  res.json(await buildOrderResponse(order));
});

export default router;
