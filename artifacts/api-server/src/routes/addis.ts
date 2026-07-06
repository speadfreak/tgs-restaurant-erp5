import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  suppliersAddisTable,
  importShipmentsTable,
  importShipmentItemsTable,
  importPaymentsTable,
  exchangeRatesTable,
} from "@workspace/db";
import { authenticate, requireRole, ADDIS_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADDIS_ROLES));

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIERS
// ─────────────────────────────────────────────────────────────────────────────

// GET /addis/suppliers
router.get("/suppliers", async (req, res): Promise<void> => {
  const rows = await db.select().from(suppliersAddisTable).orderBy(suppliersAddisTable.name);
  res.json(rows);
});

// POST /addis/suppliers
router.post("/suppliers", async (req, res): Promise<void> => {
  const { name, contactPhone, contactEmail, addressEthiopia, notes, createdByUserId } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [supplier] = await db.insert(suppliersAddisTable).values({
    name,
    contactPhone: contactPhone ?? null,
    contactEmail: contactEmail ?? null,
    addressEthiopia: addressEthiopia ?? null,
    notes: notes ?? null,
    createdByUserId: createdByUserId ?? null,
  }).returning();
  res.status(201).json(supplier);
});

// PUT /addis/suppliers/:id
router.put("/suppliers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name, contactPhone, contactEmail, addressEthiopia, notes, active } = req.body;
  const [existing] = await db.select().from(suppliersAddisTable).where(eq(suppliersAddisTable.id, id));
  if (!existing) { res.status(404).json({ error: "Supplier not found" }); return; }
  const [updated] = await db.update(suppliersAddisTable).set({
    name: name ?? existing.name,
    contactPhone: contactPhone ?? existing.contactPhone,
    contactEmail: contactEmail ?? existing.contactEmail,
    addressEthiopia: addressEthiopia ?? existing.addressEthiopia,
    notes: notes ?? existing.notes,
    active: active ?? existing.active,
  }).where(eq(suppliersAddisTable.id, id)).returning();
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// SHIPMENTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /addis/shipments?branchId=&status=
router.get("/shipments", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  const status = req.query.status as string | undefined;

  let rows = await db.select().from(importShipmentsTable).orderBy(importShipmentsTable.createdAt);
  if (branchId) rows = rows.filter(s => s.branchId === branchId);
  if (status) rows = rows.filter(s => s.status === status);
  res.json(rows);
});

// POST /addis/shipments (with items array)
router.post("/shipments", async (req, res): Promise<void> => {
  const {
    branchId, supplierId, reference, sentDate, estimatedArrivalDate,
    totalValueEtb, totalValueAed, exchangeRateUsed, notes, loggedByUserId, items,
  } = req.body;

  if (!branchId || !supplierId || !reference || !sentDate || !loggedByUserId) {
    res.status(400).json({ error: "branchId, supplierId, reference, sentDate, loggedByUserId required" }); return;
  }

  const [shipment] = await db.insert(importShipmentsTable).values({
    branchId,
    supplierId,
    reference,
    sentDate,
    estimatedArrivalDate: estimatedArrivalDate ?? null,
    totalValueEtb: totalValueEtb ? String(totalValueEtb) : "0",
    totalValueAed: totalValueAed ? String(totalValueAed) : "0",
    exchangeRateUsed: exchangeRateUsed ? String(exchangeRateUsed) : "1",
    notes: notes ?? null,
    loggedByUserId,
  }).returning();

  if (items && Array.isArray(items) && items.length > 0) {
    await db.insert(importShipmentItemsTable).values(
      items.map((item: {
        itemName: string;
        quantity: number;
        unit: string;
        unitCostEtb?: number;
        unitCostAed?: number;
        totalCostEtb?: number;
        totalCostAed?: number;
      }) => ({
        shipmentId: shipment.id,
        itemName: item.itemName,
        quantity: String(item.quantity),
        unit: item.unit,
        unitCostEtb: item.unitCostEtb ? String(item.unitCostEtb) : "0",
        unitCostAed: item.unitCostAed ? String(item.unitCostAed) : "0",
        totalCostEtb: item.totalCostEtb ? String(item.totalCostEtb) : "0",
        totalCostAed: item.totalCostAed ? String(item.totalCostAed) : "0",
      }))
    );
  }

  res.status(201).json(shipment);
});

// GET /addis/shipments/:id (with items and payments)
router.get("/shipments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [shipment] = await db.select().from(importShipmentsTable).where(eq(importShipmentsTable.id, id));
  if (!shipment) { res.status(404).json({ error: "Shipment not found" }); return; }

  const items = await db.select().from(importShipmentItemsTable).where(eq(importShipmentItemsTable.shipmentId, id));
  const payments = await db.select().from(importPaymentsTable).where(eq(importPaymentsTable.shipmentId, id));

  res.json({ ...shipment, items, payments });
});

// POST /addis/shipments/:id/receive
router.post("/shipments/:id/receive", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { receivedByUserId, actualArrivalDate, discrepancyNotes } = req.body;
  if (!receivedByUserId) { res.status(400).json({ error: "receivedByUserId required" }); return; }

  const [existing] = await db.select().from(importShipmentsTable).where(eq(importShipmentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Shipment not found" }); return; }

  const [updated] = await db.update(importShipmentsTable).set({
    status: "received",
    receivedByUserId,
    receivedAt: new Date(),
    actualArrivalDate: actualArrivalDate ?? new Date().toISOString().split("T")[0],
    discrepancyNotes: discrepancyNotes ?? null,
  }).where(eq(importShipmentsTable.id, id)).returning();

  res.json(updated);
});

// POST /addis/shipments/:id/payments
router.post("/shipments/:id/payments", async (req, res): Promise<void> => {
  const shipmentId = parseInt(req.params.id, 10);
  const { amountAed, paymentDate, paymentMethod, notes, recordedByUserId } = req.body;
  if (!amountAed || !paymentDate || !paymentMethod || !recordedByUserId) {
    res.status(400).json({ error: "amountAed, paymentDate, paymentMethod, recordedByUserId required" }); return;
  }

  const [existing] = await db.select().from(importShipmentsTable).where(eq(importShipmentsTable.id, shipmentId));
  if (!existing) { res.status(404).json({ error: "Shipment not found" }); return; }

  const [payment] = await db.insert(importPaymentsTable).values({
    shipmentId,
    amountAed: String(amountAed),
    paymentDate,
    paymentMethod,
    notes: notes ?? null,
    recordedByUserId,
  }).returning();

  res.status(201).json(payment);
});

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

// GET /addis/credit-summary?branchId=
router.get("/credit-summary", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;

  let shipments = await db.select().from(importShipmentsTable);
  if (branchId) shipments = shipments.filter(s => s.branchId === branchId);

  const summary = await Promise.all(
    shipments.map(async (s) => {
      const payments = await db.select().from(importPaymentsTable).where(eq(importPaymentsTable.shipmentId, s.id));
      const totalPaid = payments.reduce((acc, p) => acc + parseFloat(String(p.amountAed)), 0);
      const totalOwed = parseFloat(String(s.totalValueAed));
      const outstanding = Math.max(0, totalOwed - totalPaid);
      return {
        shipmentId: s.id,
        reference: s.reference,
        supplierId: s.supplierId,
        branchId: s.branchId,
        status: s.status,
        sentDate: s.sentDate,
        totalValueAed: totalOwed,
        totalPaidAed: totalPaid,
        outstandingAed: outstanding,
        paymentCount: payments.length,
      };
    })
  );

  const totalOutstanding = summary.reduce((acc, s) => acc + s.outstandingAed, 0);
  const totalOwed = summary.reduce((acc, s) => acc + s.totalValueAed, 0);
  const totalPaid = summary.reduce((acc, s) => acc + s.totalPaidAed, 0);

  res.json({
    summary,
    totals: { totalOwed, totalPaid, totalOutstanding },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXCHANGE RATES
// ─────────────────────────────────────────────────────────────────────────────

// GET /addis/exchange-rate
router.get("/exchange-rate", async (req, res): Promise<void> => {
  const from = (req.query.from as string) || "ETB";
  const to = (req.query.to as string) || "AED";
  const rows = await db.select().from(exchangeRatesTable);
  const rate = rows.find(r => r.fromCurrency === from && r.toCurrency === to);
  res.json(rate ?? { fromCurrency: from, toCurrency: to, rate: "1" });
});

// PUT /addis/exchange-rate
router.put("/exchange-rate", async (req, res): Promise<void> => {
  const { fromCurrency, toCurrency, rate, setByUserId } = req.body;
  if (!fromCurrency || !toCurrency || rate === undefined) {
    res.status(400).json({ error: "fromCurrency, toCurrency, rate required" }); return;
  }

  const existing = await db.select().from(exchangeRatesTable);
  const match = existing.find(r => r.fromCurrency === fromCurrency && r.toCurrency === toCurrency);

  if (match) {
    const [updated] = await db.update(exchangeRatesTable).set({
      rate: String(rate),
      setByUserId: setByUserId ?? null,
      updatedAt: new Date(),
    }).where(eq(exchangeRatesTable.id, match.id)).returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(exchangeRatesTable).values({
      fromCurrency,
      toCurrency,
      rate: String(rate),
      setByUserId: setByUserId ?? null,
    }).returning();
    res.json(created);
  }
});

export default router;
