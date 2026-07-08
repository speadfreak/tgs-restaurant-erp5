/**
 * Excel (.xlsx) export endpoints — mirrors the CSV audit routes but uses
 * ExcelJS for richly-formatted worksheets with TG's amber branding.
 */

import { Router } from "express";
import { and, eq, gte, lt } from "drizzle-orm";
import { db, ordersTable, orderStatusHistoryTable, usersTable, branchesTable, customersTable, inventoryItemsTable } from "@workspace/db";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";
import ExcelJS from "exceljs";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES));

/** Apply TG amber header style to the first row of a worksheet. */
function styleHeader(ws: ExcelJS.Worksheet) {
  const headerRow = ws.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF59E0B" } };
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  headerRow.height = 20;
}

async function sendXlsx(res: Parameters<typeof router.get>[1] extends (...args: infer A) => unknown ? A[1] : never, wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

// GET /audit/daily-orders/xlsx?date=YYYY-MM-DD&branchId=
router.get("/audit/daily-orders/xlsx", async (req, res): Promise<void> => {
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

  const wb = new ExcelJS.Workbook();
  wb.creator = "TG Restaurant ERP";
  const ws = wb.addWorksheet("Daily Orders");

  ws.columns = [
    { header: "Order Code", key: "orderCode", width: 14 },
    { header: "Branch", key: "branch", width: 16 },
    { header: "Created At", key: "createdAt", width: 22 },
    { header: "Channel", key: "channel", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Customer Name", key: "customerName", width: 22 },
    { header: "Customer Phone", key: "customerPhone", width: 18 },
    { header: "Total (AED)", key: "totalAed", width: 13 },
    { header: "Payment Method", key: "paymentMethod", width: 16 },
    { header: "Relayed By", key: "relayedBy", width: 18 },
    { header: "Accepted By", key: "acceptedBy", width: 18 },
    { header: "Accepted At", key: "acceptedAt", width: 22 },
    { header: "Marked Ready By", key: "markedReadyBy", width: 18 },
    { header: "Marked Ready At", key: "markedReadyAt", width: 22 },
    { header: "Assigned Delivery", key: "assignedDelivery", width: 18 },
    { header: "Claimed At", key: "claimedAt", width: 22 },
  ];

  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .forEach(o => ws.addRow({
      orderCode: o.orderCode,
      branch: branchMap.get(o.branchId) ?? "",
      createdAt: o.createdAt.toISOString(),
      channel: o.channel,
      status: o.status,
      customerName: o.customerNameDirect ?? customerMap.get(o.customerId ?? -1)?.name ?? "",
      customerPhone: o.customerPhoneDirect ?? customerMap.get(o.customerId ?? -1)?.phone ?? "",
      totalAed: Number(o.totalAed),
      paymentMethod: o.paymentMethod ?? "",
      relayedBy: o.relayedByUserId ? (userMap.get(o.relayedByUserId) ?? "") : "",
      acceptedBy: o.acceptedByUserId ? (userMap.get(o.acceptedByUserId) ?? "") : "",
      acceptedAt: o.acceptedAt?.toISOString() ?? "",
      markedReadyBy: o.markedReadyByUserId ? (userMap.get(o.markedReadyByUserId) ?? "") : "",
      markedReadyAt: o.markedReadyAt?.toISOString() ?? "",
      assignedDelivery: o.assignedDeliveryUserId ? (userMap.get(o.assignedDeliveryUserId) ?? "") : "",
      claimedAt: o.claimedAt?.toISOString() ?? "",
    }));

  styleHeader(ws);
  await sendXlsx(res, wb, `daily-order-audit-${date}.xlsx`);
});

// GET /audit/order-history/xlsx?date=YYYY-MM-DD&branchId=
router.get("/audit/order-history/xlsx", async (req, res): Promise<void> => {
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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Order History");
  ws.columns = [
    { header: "Order Code", key: "orderCode", width: 14 },
    { header: "Status", key: "status", width: 18 },
    { header: "Changed By", key: "changedBy", width: 18 },
    { header: "Changed At", key: "changedAt", width: 22 },
  ];
  filtered.sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
    .forEach(h => ws.addRow({
      orderCode: orderMap.get(h.orderId)?.orderCode ?? h.orderId,
      status: h.status,
      changedBy: h.changedBy ? (userMap.get(h.changedBy) ?? "") : "system",
      changedAt: h.changedAt.toISOString(),
    }));
  styleHeader(ws);
  await sendXlsx(res, wb, `order-history-${date}.xlsx`);
});

// GET /audit/staff-activity/xlsx?date=YYYY-MM-DD&branchId=
router.get("/audit/staff-activity/xlsx", async (req, res): Promise<void> => {
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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Staff Activity");
  ws.columns = [
    { header: "Staff Name", key: "staffName", width: 22 },
    { header: "Role", key: "role", width: 16 },
    { header: "Branch", key: "branch", width: 16 },
    { header: "Date", key: "date", width: 12 },
    { header: "Orders Relayed", key: "ordersRelayed", width: 15 },
    { header: "Orders Prepared", key: "ordersPrepared", width: 16 },
    { header: "Orders Delivered", key: "ordersDelivered", width: 17 },
    { header: "Total Actions", key: "totalActions", width: 14 },
    { header: "Commission (AED)", key: "commission", width: 17 },
  ];

  targetUsers.forEach(u => {
    const relayed = allOrders.filter(o => o.relayedByUserId === u.id).length;
    const accepted = allOrders.filter(o => o.acceptedByUserId === u.id).length;
    const delivered = allOrders.filter(o => o.assignedDeliveryUserId === u.id && o.status === "delivered").length;
    const commission = allOrders
      .filter(o => o.assignedDeliveryUserId === u.id && o.status === "delivered")
      .reduce((s, o) => {
        const rate = u.commissionRate ? Number(u.commissionRate) : 0;
        return s + (rate > 1 ? rate : Number(o.totalAed) * rate);
      }, 0);
    ws.addRow({
      staffName: u.name,
      role: u.role,
      branch: branchMap.get(u.branchId ?? -1) ?? "",
      date,
      ordersRelayed: relayed,
      ordersPrepared: accepted,
      ordersDelivered: delivered,
      totalActions: relayed + accepted + delivered,
      commission: commission.toFixed(2),
    });
  });

  styleHeader(ws);
  await sendXlsx(res, wb, `staff-activity-${date}.xlsx`);
});

// GET /audit/weekly-revenue/xlsx?weekStart=YYYY-MM-DD&branchId=
router.get("/audit/weekly-revenue/xlsx", async (req, res): Promise<void> => {
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split("T")[0];
  })();
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const allBranches = await db.select().from(branchesTable);
  const targetBranches = branchId ? allBranches.filter(b => b.id === branchId) : allBranches;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Weekly Revenue");
  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Branch", key: "branch", width: 16 },
    { header: "Total Orders", key: "totalOrders", width: 14 },
    { header: "Delivered Orders", key: "deliveredOrders", width: 17 },
    { header: "Total Revenue (AED)", key: "totalRevenueAed", width: 20 },
    { header: "WhatsApp Orders", key: "whatsappOrders", width: 17 },
    { header: "Relay Orders", key: "relayOrders", width: 14 },
    { header: "Web App Orders", key: "webOrders", width: 15 },
    { header: "Avg Order Value (AED)", key: "avgOrderValue", width: 21 },
  ];

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
      ws.addRow({
        date: dayStr,
        branch: branch.name,
        totalOrders: orders.length,
        deliveredOrders: delivered.length,
        totalRevenueAed: totalRevenue.toFixed(2),
        whatsappOrders: orders.filter(o => o.channel === "whatsapp" || o.channel === "whatsapp_voice").length,
        relayOrders: orders.filter(o => o.channel === "whatsapp_relay").length,
        webOrders: orders.filter(o => o.channel === "webapp").length,
        avgOrderValue: delivered.length ? (totalRevenue / delivered.length).toFixed(2) : "0.00",
      });
    }
  }
  styleHeader(ws);
  await sendXlsx(res, wb, `weekly-revenue-${weekStart}.xlsx`);
});

// GET /audit/inventory-report/xlsx
router.get("/audit/inventory-report/xlsx", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const allItems = await db.select().from(inventoryItemsTable);
  const allBranches = await db.select().from(branchesTable);
  const branchMap = new Map(allBranches.map(b => [b.id, b.name]));
  const items = branchId ? allItems.filter(i => i.branchId === branchId) : allItems;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Inventory");
  ws.columns = [
    { header: "Item Name", key: "itemName", width: 24 },
    { header: "Branch", key: "branch", width: 16 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Current Quantity", key: "currentQuantity", width: 18 },
    { header: "Reorder Threshold", key: "reorderThreshold", width: 18 },
    { header: "Reorder Quantity", key: "reorderQuantity", width: 17 },
    { header: "Below Reorder?", key: "belowReorder", width: 15 },
    { header: "Supplier", key: "supplier", width: 20 },
    { header: "Added Date", key: "addedDate", width: 22 },
  ];

  items.forEach(i => {
    const below = Number(i.quantityOnHand) <= Number(i.reorderThreshold);
    const row = ws.addRow({
      itemName: i.name,
      branch: branchMap.get(i.branchId) ?? "",
      unit: i.unit,
      currentQuantity: Number(i.quantityOnHand).toFixed(3),
      reorderThreshold: Number(i.reorderThreshold).toFixed(3),
      reorderQuantity: Number(i.reorderQuantity).toFixed(3),
      belowReorder: below ? "YES" : "NO",
      supplier: i.supplier ?? "",
      addedDate: i.createdAt.toISOString(),
    });
    if (below) {
      row.getCell("belowReorder").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEF4444" } };
      row.getCell("belowReorder").font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
  });

  styleHeader(ws);
  await sendXlsx(res, wb, `inventory-report.xlsx`);
});

export default router;
