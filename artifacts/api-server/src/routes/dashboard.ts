import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, ordersTable, deliveriesTable, inventoryItemsTable, menuItemsTable, orderItemsTable, branchesTable, usersTable } from "@workspace/db";
import {
  GetDashboardSummaryQueryParams,
  GetDashboardSummaryResponse,
  GetLiveOrdersQueryParams,
  GetLiveOrdersResponse,
  GetDashboardAlertsQueryParams,
  GetDashboardAlertsResponse,
  GetTopMenuItemsQueryParams,
  GetTopMenuItemsResponse,
  GetBranchStatsResponse,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES));

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const q = GetDashboardSummaryQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let orders = await db.select().from(ordersTable);
  let deliveries = await db.select().from(deliveriesTable);
  let inventory = await db.select().from(inventoryItemsTable);

  if (q.data.branchId) {
    orders = orders.filter(o => o.branchId === q.data.branchId);
    inventory = inventory.filter(i => i.branchId === q.data.branchId);
  }

  const todayOrders = orders.filter(o => o.createdAt >= today);
  const todayRevenue = todayOrders
    .filter(o => o.status === "delivered")
    .reduce((acc, o) => acc + Number(o.totalAed), 0);
  const activeDeliveries = deliveries.filter(d => d.deliveryStatus === "assigned" || d.deliveryStatus === "picked_up").length;
  const pendingKitchen = orders.filter(o => ["pending", "confirmed", "preparing"].includes(o.status)).length;
  const lowStockAlerts = inventory.filter(i => Number(i.quantityOnHand) <= Number(i.reorderThreshold)).length;

  res.json(GetDashboardSummaryResponse.parse({
    todayOrders: todayOrders.length,
    todayRevenue,
    activeDeliveries,
    pendingKitchen,
    lowStockAlerts,
    avgPrepMinutes: null,
    avgDeliveryMinutes: null,
    lotteryDrawToday: false,
    onlineStaff: 0,
  }));
});

router.get("/dashboard/live-orders", async (req, res): Promise<void> => {
  const q = GetLiveOrdersQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const activeStatuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery"];
  let orders = await db.select().from(ordersTable);
  orders = orders.filter(o => activeStatuses.includes(o.status));
  if (q.data.branchId) orders = orders.filter(o => o.branchId === q.data.branchId);
  orders = orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20);

  const branches = await db.select().from(branchesTable);
  const branchMap = new Map(branches.map(b => [b.id, b.name]));
  const nameMap = new Map<number, string>();
  for (const mi of await db.select().from(menuItemsTable)) {
    nameMap.set(mi.id, mi.nameEn);
  }

  const results = await Promise.all(orders.map(async order => {
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    return {
      id: order.id,
      orderCode: order.orderCode,
      branchId: order.branchId,
      branchName: branchMap.get(order.branchId) ?? null,
      customerId: order.customerId ?? null,
      customerName: null,
      customerPhone: null,
      channel: order.channel,
      status: order.status,
      totalAed: Number(order.totalAed),
      paymentMethod: order.paymentMethod ?? null,
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
  res.json(GetLiveOrdersResponse.parse(results));
});

router.get("/dashboard/alerts", async (req, res): Promise<void> => {
  const q = GetDashboardAlertsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const alerts = [];
  let inventory = await db.select().from(inventoryItemsTable);
  let orders = await db.select().from(ordersTable);
  const branches = await db.select().from(branchesTable);
  const branchMap = new Map(branches.map(b => [b.id, b.name]));

  if (q.data.branchId) {
    inventory = inventory.filter(i => i.branchId === q.data.branchId);
    orders = orders.filter(o => o.branchId === q.data.branchId);
  }

  for (const item of inventory) {
    if (Number(item.quantityOnHand) <= Number(item.reorderThreshold)) {
      alerts.push({
        id: `low_stock_${item.id}`,
        type: "low_stock" as const,
        severity: "warning" as const,
        message: `${item.name} is running low (${item.quantityOnHand} ${item.unit} remaining)`,
        branchId: item.branchId,
        branchName: branchMap.get(item.branchId) ?? null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const delayedOrders = orders.filter(o =>
    ["preparing", "confirmed"].includes(o.status) && o.createdAt < thirtyMinsAgo
  );
  for (const order of delayedOrders.slice(0, 5)) {
    alerts.push({
      id: `delayed_${order.id}`,
      type: "delayed_order" as const,
      severity: "critical" as const,
      message: `Order ${order.orderCode} has been ${order.status} for over 30 minutes`,
      branchId: order.branchId,
      branchName: branchMap.get(order.branchId) ?? null,
      createdAt: order.createdAt.toISOString(),
    });
  }

  res.json(GetDashboardAlertsResponse.parse(alerts));
});

router.get("/dashboard/top-items", async (req, res): Promise<void> => {
  const q = GetTopMenuItemsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const limit = q.data.limit ?? 10;
  const allItems = await db.select().from(orderItemsTable);
  const menuItems = await db.select().from(menuItemsTable);
  const menuMap = new Map(menuItems.map(m => [m.id, m]));

  const counts = new Map<number, { totalSold: number; totalRevenue: number }>();
  for (const item of allItems) {
    const existing = counts.get(item.menuItemId) ?? { totalSold: 0, totalRevenue: 0 };
    existing.totalSold += item.quantity;
    existing.totalRevenue += item.quantity * Number(item.unitPrice);
    counts.set(item.menuItemId, existing);
  }

  const result = Array.from(counts.entries())
    .sort((a, b) => b[1].totalSold - a[1].totalSold)
    .slice(0, limit)
    .map(([menuItemId, stats]) => {
      const mi = menuMap.get(menuItemId);
      return {
        menuItemId,
        nameEn: mi?.nameEn ?? "Unknown",
        nameAm: mi?.nameAm ?? null,
        totalSold: stats.totalSold,
        totalRevenue: stats.totalRevenue,
        photoUrl: mi?.photoUrl ?? null,
      };
    });

  res.json(GetTopMenuItemsResponse.parse(result));
});

router.get("/dashboard/branch-stats", async (req, res): Promise<void> => {
  const branches = await db.select().from(branchesTable).where(eq(branchesTable.active, true));
  const orders = await db.select().from(ordersTable);
  const users = await db.select().from(usersTable);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stats = branches.map(b => {
    const branchOrders = orders.filter(o => o.branchId === b.id);
    const todayOrders = branchOrders.filter(o => o.createdAt >= today);
    const todayRevenue = todayOrders.filter(o => o.status === "delivered").reduce((acc, o) => acc + Number(o.totalAed), 0);
    const activeStaff = users.filter(u => u.branchId === b.id && u.active).length;
    const pendingOrders = branchOrders.filter(o => ["pending", "confirmed", "preparing"].includes(o.status)).length;
    return {
      branchId: b.id,
      branchName: b.name,
      todayOrders: todayOrders.length,
      todayRevenue,
      activeStaff,
      pendingOrders,
    };
  });

  res.json(GetBranchStatsResponse.parse(stats));
});

export default router;
