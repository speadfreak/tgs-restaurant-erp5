import { Router } from "express";
import { and, eq, gte, lt } from "drizzle-orm";
import { db, ordersTable, orderStatusHistoryTable, usersTable, branchesTable, customersTable, inventoryItemsTable } from "@workspace/db";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use("/audit", authenticate, requireRole(...ADMIN_ROLES));

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const body = rows.map(r => columns.map(c => csvEscape(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

// GET /audit/daily-orders?date=YYYY-MM-DD&branchId=
router.get("/audit/daily-orders", async (req, res): Promise<void> => {
  const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().split("T")[0];
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  let rows = await db.select().from(ordersTable).where(and(gte(ordersTable.createdAt, dayStart), lt(ordersTable.createdAt, dayEnd)));
  if (branchId) rows = rows.filter(o => o.branchId === branchId);

  const allUsers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(allUsers.map(u => [u.id, u.name]));
  const allBranches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  const branchMap = new Map(allBranches.map(b => [b.id, b.name]));
  const allCustomers = await db.select({ id: customersTable.id, name: customersTable.name, phone: customersTable.phone }).from(customersTable);
  const customerMap = new Map(allCustomers.map(c => [c.id, c]));

  const auditRows = rows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(o => ({
      orderCode: o.orderCode,
      branch: branchMap.get(o.branchId) ?? "",
      createdAt: o.createdAt.toISOString(),
      channel: o.channel,
      status: o.status,
      customerName: o.customerNameDirect ?? customerMap.get(o.customerId ?? -1)?.name ?? "",
      customerPhone: o.customerPhoneDirect ?? customerMap.get(o.customerId ?? -1)?.phone ?? "",
      totalAed: Number(o.totalAed).toFixed(2),
      paymentMethod: o.paymentMethod ?? "",
      relayedBy: o.relayedByUserId ? (userMap.get(o.relayedByUserId) ?? "") : "",
      acceptedBy: o.acceptedByUserId ? (userMap.get(o.acceptedByUserId) ?? "") : "",
      acceptedAt: o.acceptedAt?.toISOString() ?? "",
      markedReadyBy: o.markedReadyByUserId ? (userMap.get(o.markedReadyByUserId) ?? "") : "",
      markedReadyAt: o.markedReadyAt?.toISOString() ?? "",
      assignedDelivery: o.assignedDeliveryUserId ? (userMap.get(o.assignedDeliveryUserId) ?? "") : "",
      claimedAt: o.claimedAt?.toISOString() ?? "",
    }));

  const columns = [
    "orderCode", "branch", "createdAt", "channel", "status",
    "customerName", "customerPhone", "totalAed", "paymentMethod",
    "relayedBy", "acceptedBy", "acceptedAt", "markedReadyBy", "markedReadyAt",
    "assignedDelivery", "claimedAt",
  ];
  const csv = toCsv(auditRows, columns);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="daily-order-audit-${date}.csv"`);
  res.send(csv);
});

// GET /audit/order-history?date=YYYY-MM-DD&branchId= — full status-change trail for the day
router.get("/audit/order-history", async (req, res): Promise<void> => {
  const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().split("T")[0];
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const history = await db.select().from(orderStatusHistoryTable).where(and(gte(orderStatusHistoryTable.changedAt, dayStart), lt(orderStatusHistoryTable.changedAt, dayEnd)));
  const orderIds = [...new Set(history.map(h => h.orderId))];
  const orders = orderIds.length ? await db.select().from(ordersTable) : [];
  const orderMap = new Map(orders.map(o => [o.id, o]));
  const allUsers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(allUsers.map(u => [u.id, u.name]));

  let filtered = history;
  if (branchId) filtered = filtered.filter(h => orderMap.get(h.orderId)?.branchId === branchId);

  const rows = filtered
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
    .map(h => ({
      orderCode: orderMap.get(h.orderId)?.orderCode ?? h.orderId,
      status: h.status,
      changedBy: h.changedBy ? (userMap.get(h.changedBy) ?? "") : "system",
      changedAt: h.changedAt.toISOString(),
    }));

  const columns = ["orderCode", "status", "changedBy", "changedAt"];
  const csv = toCsv(rows, columns);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="order-history-audit-${date}.csv"`);
  res.send(csv);
});

// GET /audit/weekly-revenue?weekStart=YYYY-MM-DD&branchId=
router.get("/audit/weekly-revenue", async (req, res): Promise<void> => {
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split("T")[0];
  })();
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const allBranches = await db.select().from(branchesTable);
  const targetBranches = branchId ? allBranches.filter(b => b.id === branchId) : allBranches;

  const rows: Record<string, unknown>[] = [];

  for (const branch of targetBranches) {
    for (let d = 0; d < 7; d++) {
      const dayStart = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const dayStr = dayStart.toISOString().split("T")[0];

      const orders = await db.select().from(ordersTable).where(
        and(eq(ordersTable.branchId, branch.id), gte(ordersTable.createdAt, dayStart), lt(ordersTable.createdAt, dayEnd))
      );
      const delivered = orders.filter(o => o.status === "delivered");
      const totalRevenue = delivered.reduce((s, o) => s + Number(o.totalAed), 0);
      const waOrders = orders.filter(o => o.channel === "whatsapp" || o.channel === "whatsapp_voice").length;
      const relayOrders = orders.filter(o => o.channel === "whatsapp_relay").length;
      const webOrders = orders.filter(o => o.channel === "webapp").length;
      const avgOrderValue = delivered.length ? totalRevenue / delivered.length : 0;

      rows.push({
        date: dayStr,
        branch: branch.name,
        totalOrders: orders.length,
        deliveredOrders: delivered.length,
        totalRevenueAed: totalRevenue.toFixed(2),
        whatsappOrdersCount: waOrders,
        relayOrdersCount: relayOrders,
        webappOrdersCount: webOrders,
        averageOrderValueAed: avgOrderValue.toFixed(2),
      });
    }
  }

  const columns = ["date", "branch", "totalOrders", "deliveredOrders", "totalRevenueAed", "whatsappOrdersCount", "relayOrdersCount", "webappOrdersCount", "averageOrderValueAed"];
  const csv = toCsv(rows, columns);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="weekly-revenue-${weekStart}.csv"`);
  res.send(csv);
});

// GET /audit/staff-activity?date=YYYY-MM-DD&branchId=
router.get("/audit/staff-activity", async (req, res): Promise<void> => {
  const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().split("T")[0];
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const allUsers = await db.select().from(usersTable);
  const allBranches = await db.select().from(branchesTable);
  const branchMap = new Map(allBranches.map(b => [b.id, b.name]));
  const allOrders = await db.select().from(ordersTable).where(and(gte(ordersTable.createdAt, dayStart), lt(ordersTable.createdAt, dayEnd)));

  let targetUsers = allUsers.filter(u => ["delivery_staff", "kitchen_staff", "order_staff", "addis_staff"].includes(u.role));
  if (branchId) targetUsers = targetUsers.filter(u => u.branchId === branchId);

  const rows = targetUsers.map(u => {
    const relayed = allOrders.filter(o => o.relayedByUserId === u.id).length;
    const accepted = allOrders.filter(o => o.acceptedByUserId === u.id).length;
    const delivered = allOrders.filter(o => o.assignedDeliveryUserId === u.id && o.status === "delivered").length;
    const commission = allOrders
      .filter(o => o.assignedDeliveryUserId === u.id && o.status === "delivered")
      .reduce((s, o) => {
        const rate = u.commissionRate ? Number(u.commissionRate) : 0;
        return s + (rate > 1 ? rate : Number(o.totalAed) * rate);
      }, 0);
    const actions = relayed + accepted + delivered;

    return {
      staffName: u.name,
      role: u.role,
      branch: branchMap.get(u.branchId ?? -1) ?? "",
      date,
      ordersRelayed: relayed,
      ordersPrepared: accepted,
      ordersDelivered: delivered,
      totalActions: actions,
      commissionEarnedAed: commission.toFixed(2),
      currentStatus: u.currentStatus,
      chefStatus: u.chefStatus,
    };
  });

  const columns = ["staffName", "role", "branch", "date", "ordersRelayed", "ordersPrepared", "ordersDelivered", "totalActions", "commissionEarnedAed", "currentStatus", "chefStatus"];
  const csv = toCsv(rows, columns);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="staff-activity-${date}.csv"`);
  res.send(csv);
});

// GET /audit/inventory-report?date=YYYY-MM-DD&branchId=
router.get("/audit/inventory-report", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  const allItems = await db.select().from(inventoryItemsTable);
  const allBranches = await db.select().from(branchesTable);
  const branchMap = new Map(allBranches.map(b => [b.id, b.name]));

  let items = allItems;
  if (branchId) items = items.filter(i => i.branchId === branchId);

  const rows = items.map(i => ({
    itemName: i.name,
    branch: branchMap.get(i.branchId) ?? "",
    unit: i.unit,
    currentQuantity: Number(i.quantityOnHand).toFixed(3),
    reorderThreshold: Number(i.reorderThreshold).toFixed(3),
    reorderQuantity: Number(i.reorderQuantity).toFixed(3),
    belowReorder: Number(i.quantityOnHand) <= Number(i.reorderThreshold) ? "YES" : "NO",
    supplier: i.supplier ?? "",
    addedDate: i.createdAt.toISOString(),
  }));

  const columns = ["itemName", "branch", "unit", "currentQuantity", "reorderThreshold", "reorderQuantity", "belowReorder", "supplier", "addedDate"];
  const csv = toCsv(rows, columns);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="inventory-report.csv"`);
  res.send(csv);
});

export default router;
