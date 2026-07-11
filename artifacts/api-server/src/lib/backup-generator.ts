/**
 * Builds the weekly backup workbook — one branded Excel sheet per operational
 * table, styled to match TG's amber theme. Read-only: does not touch the DB
 * beyond SELECTs.
 *
 * IMPORTANT: every table that weekly-backup.ts clears MUST have a sheet here.
 * The caller passes in a transaction client (`tx`) so these SELECTs share the
 * exact same REPEATABLE READ snapshot as the DELETEs that follow — that way
 * nothing can be deleted that wasn't captured in the exported file.
 */
import ExcelJS from "exceljs";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import {
  ordersTable,
  orderItemsTable,
  orderStatusHistoryTable,
  deliveriesTable,
  lotteryEntriesTable,
  lotteryDrawsTable,
  lotteryWinnersTable,
  financeEntriesTable,
  expensesTable,
  commissionsTable,
  timesheetsTable,
  whatsappMessagesTable,
  importShipmentsTable,
  importShipmentItemsTable,
  importPaymentsTable,
  loginAttemptsTable,
  staffActivitiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

export type BackupDb = NodePgDatabase<typeof schema>;

type ColumnDef = { header: string; key: string; width: number };

const HEADER_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFB45309" } }, // amber
  alignment: { horizontal: "center" },
  border: {
    bottom: { style: "medium", color: { argb: "FF92400E" } },
  },
};

export async function generateBackupExcel(weekLabel: string, tx: BackupDb): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "TG's Restaurant ERP (ቲጂ ምግብ ቤት)";
  workbook.created = new Date();
  workbook.title = `TG's Restaurant Weekly Backup — ${weekLabel}`;

  async function addSheet(name: string, data: Record<string, unknown>[], columns: ColumnDef[]) {
    const sheet = workbook.addWorksheet(name);

    sheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = sheet.getCell("A1");
    titleCell.value = `TG's Restaurant — ${name} — Week of ${weekLabel}`;
    titleCell.font = { bold: true, size: 13, color: { argb: "FFB45309" } };
    titleCell.alignment = { horizontal: "center" };
    sheet.getRow(1).height = 25;

    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    const headerRow = sheet.getRow(2);
    headerRow.values = columns.map((c) => c.header);
    headerRow.eachCell((cell) => Object.assign(cell, HEADER_STYLE));
    headerRow.height = 20;

    data.forEach((row, i) => {
      const dataRow = sheet.addRow(columns.map((c) => (row[c.key] as string | number | boolean | Date | null) ?? ""));
      if (i % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
        });
      }
    });

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };
    return sheet;
  }

  // ── ORDERS ──
  const ordersData = await tx.select().from(ordersTable);
  await addSheet("Orders", ordersData, [
    { header: "Order Code", key: "orderCode", width: 18 },
    { header: "Channel", key: "channel", width: 16 },
    { header: "Status", key: "status", width: 16 },
    { header: "Customer Name", key: "customerNameDirect", width: 20 },
    { header: "Customer Phone", key: "customerPhoneDirect", width: 18 },
    { header: "Delivery Address", key: "deliveryAddress", width: 30 },
    { header: "Total (AED)", key: "totalAed", width: 14 },
    { header: "Branch ID", key: "branchId", width: 12 },
    { header: "Created At", key: "createdAt", width: 22 },
    { header: "Accepted At", key: "acceptedAt", width: 22 },
    { header: "Ready At", key: "markedReadyAt", width: 22 },
  ]);

  // ── ORDER ITEMS ──
  const orderItemsData = await tx.select().from(orderItemsTable);
  await addSheet("Order Items", orderItemsData, [
    { header: "Order ID", key: "orderId", width: 12 },
    { header: "Menu Item ID", key: "menuItemId", width: 14 },
    { header: "Quantity", key: "quantity", width: 10 },
    { header: "Unit Price (AED)", key: "unitPrice", width: 16 },
    { header: "Notes", key: "notes", width: 30 },
  ]);

  // ── ORDER STATUS HISTORY ──
  const statusHistoryData = await tx.select().from(orderStatusHistoryTable);
  await addSheet("Order Status History", statusHistoryData, [
    { header: "Order ID", key: "orderId", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "Changed By (User ID)", key: "changedBy", width: 18 },
    { header: "Note", key: "note", width: 30 },
    { header: "Changed At", key: "changedAt", width: 22 },
  ]);

  // ── DELIVERIES ──
  const deliveriesData = await tx.select().from(deliveriesTable);
  await addSheet("Deliveries", deliveriesData, [
    { header: "Order ID", key: "orderId", width: 12 },
    { header: "Rider ID", key: "deliveryStaffId", width: 12 },
    { header: "Status", key: "deliveryStatus", width: 16 },
    { header: "Picked Up At", key: "pickedUpAt", width: 22 },
    { header: "Delivered At", key: "deliveredAt", width: 22 },
    { header: "Amount Collected (AED)", key: "amountCollected", width: 22 },
  ]);

  // ── LOTTERY ENTRIES ──
  const lotteryData = await tx.select().from(lotteryEntriesTable);
  await addSheet("Lottery Entries", lotteryData, [
    { header: "Order ID", key: "orderId", width: 12 },
    { header: "Customer Phone", key: "customerPhone", width: 18 },
    { header: "Customer Name", key: "customerName", width: 20 },
    { header: "Lucky Number", key: "luckyNumber", width: 14 },
    { header: "Draw Date", key: "drawDate", width: 14 },
    { header: "Is Winner", key: "isWinner", width: 10 },
    { header: "Prize Tier", key: "prizeTier", width: 16 },
    { header: "Manually Sent", key: "manuallySent", width: 14 },
  ]);

  // ── LOTTERY DRAWS ──
  const lotteryDrawsData = await tx.select().from(lotteryDrawsTable);
  await addSheet("Lottery Draws", lotteryDrawsData, [
    { header: "Branch ID", key: "branchId", width: 12 },
    { header: "Draw Date", key: "drawDate", width: 14 },
    { header: "Draw Time", key: "drawTime", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Total Entries", key: "totalEntries", width: 14 },
    { header: "Drawn At", key: "drawnAt", width: 22 },
  ]);

  // ── LOTTERY WINNERS ──
  const lotteryWinnersData = await tx.select().from(lotteryWinnersTable);
  await addSheet("Lottery Winners", lotteryWinnersData, [
    { header: "Draw ID", key: "drawId", width: 12 },
    { header: "Entry ID", key: "entryId", width: 12 },
    { header: "Prize Tier", key: "prizeTier", width: 16 },
    { header: "Prize Description", key: "prizeDescription", width: 30 },
    { header: "Notification Status", key: "notificationStatus", width: 18 },
    { header: "Notification Sent At", key: "notificationSentAt", width: 22 },
  ]);

  // ── FINANCE ENTRIES ──
  const financeData = await tx.select().from(financeEntriesTable);
  await addSheet("Finance Entries", financeData, [
    { header: "Type", key: "entryType", width: 10 },
    { header: "Category", key: "category", width: 20 },
    { header: "Amount (AED)", key: "amountAed", width: 14 },
    { header: "Description", key: "description", width: 30 },
    { header: "Date", key: "entryDate", width: 14 },
    { header: "Branch ID", key: "branchId", width: 12 },
    { header: "Logged By", key: "loggedByUserId", width: 14 },
  ]);

  // ── EXPENSES (legacy admin-logged) ──
  const expensesData = await tx.select().from(expensesTable);
  await addSheet("Expenses", expensesData, [
    { header: "Category", key: "category", width: 20 },
    { header: "Amount (AED)", key: "amountAed", width: 14 },
    { header: "Description", key: "description", width: 30 },
    { header: "Branch ID", key: "branchId", width: 12 },
    { header: "Created At", key: "createdAt", width: 22 },
  ]);

  // ── COMMISSIONS ──
  const commissionsData = await tx.select().from(commissionsTable);
  await addSheet("Commissions", commissionsData, [
    { header: "Staff ID", key: "userId", width: 12 },
    { header: "Order ID", key: "orderId", width: 12 },
    { header: "Amount (AED)", key: "amountAed", width: 14 },
    { header: "Type", key: "type", width: 14 },
    { header: "Created At", key: "createdAt", width: 22 },
  ]);

  // ── TIMESHEETS ──
  const timesheetsData = await tx.select().from(timesheetsTable);
  await addSheet("Timesheets", timesheetsData, [
    { header: "Staff ID", key: "userId", width: 12 },
    { header: "Branch ID", key: "branchId", width: 12 },
    { header: "Clock In", key: "clockIn", width: 22 },
    { header: "Clock Out", key: "clockOut", width: 22 },
  ]);

  // ── IMPORT SHIPMENTS ──
  const shipmentsData = await tx.select().from(importShipmentsTable);
  await addSheet("Import Shipments", shipmentsData, [
    { header: "Reference", key: "reference", width: 20 },
    { header: "Supplier ID", key: "supplierId", width: 14 },
    { header: "Sent Date", key: "sentDate", width: 14 },
    { header: "Status", key: "status", width: 16 },
    { header: "Total (ETB)", key: "totalValueEtb", width: 14 },
    { header: "Total (AED)", key: "totalValueAed", width: 14 },
    { header: "Notes", key: "notes", width: 30 },
  ]);

  // ── IMPORT SHIPMENT ITEMS ──
  const shipmentItemsData = await tx.select().from(importShipmentItemsTable);
  await addSheet("Import Shipment Items", shipmentItemsData, [
    { header: "Shipment ID", key: "shipmentId", width: 12 },
    { header: "Item Name", key: "itemName", width: 22 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Unit Cost (ETB)", key: "unitCostEtb", width: 16 },
    { header: "Unit Cost (AED)", key: "unitCostAed", width: 16 },
    { header: "Total Cost (AED)", key: "totalCostAed", width: 16 },
  ]);

  // ── IMPORT PAYMENTS ──
  const importPaymentsData = await tx.select().from(importPaymentsTable);
  await addSheet("Import Payments", importPaymentsData, [
    { header: "Shipment ID", key: "shipmentId", width: 12 },
    { header: "Amount (AED)", key: "amountAed", width: 14 },
    { header: "Payment Date", key: "paymentDate", width: 14 },
    { header: "Payment Method", key: "paymentMethod", width: 16 },
    { header: "Notes", key: "notes", width: 30 },
  ]);

  // ── WHATSAPP MESSAGES ──
  const waData = await tx.select().from(whatsappMessagesTable);
  await addSheet("WhatsApp Messages", waData, [
    { header: "Direction", key: "direction", width: 12 },
    { header: "Customer Phone", key: "customerPhone", width: 18 },
    { header: "Message Type", key: "messageType", width: 14 },
    { header: "Content", key: "content", width: 40 },
    { header: "Status", key: "status", width: 12 },
    { header: "Sent At", key: "sentAt", width: 22 },
  ]);

  // ── LOGIN ATTEMPTS ──
  const loginAttemptsData = await tx.select().from(loginAttemptsTable);
  await addSheet("Login Attempts", loginAttemptsData, [
    { header: "Phone", key: "phone", width: 18 },
    { header: "User ID", key: "userId", width: 12 },
    { header: "IP Address", key: "ipAddress", width: 18 },
    { header: "Success", key: "success", width: 10 },
    { header: "Attempted At", key: "attemptedAt", width: 22 },
  ]);

  // ── COMPLETED STAFF ACTIVITIES ── (only "done" ones are cleared, so only export those)
  const completedActivitiesData = await tx.select().from(staffActivitiesTable).where(eq(staffActivitiesTable.status, "done"));
  await addSheet("Completed Staff Activities", completedActivitiesData, [
    { header: "Title", key: "title", width: 30 },
    { header: "Assigned To (User ID)", key: "assignedToUserId", width: 18 },
    { header: "Assigned By (User ID)", key: "assignedByUserId", width: 18 },
    { header: "Branch ID", key: "branchId", width: 12 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Created At", key: "createdAt", width: 22 },
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
