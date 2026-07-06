import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, inventoryItemsTable, wasteLogsTable, usersTable, restockOrdersTable } from "@workspace/db";
import {
  ListInventoryItemsQueryParams,
  ListInventoryItemsResponse,
  CreateInventoryItemBody,
  CreateInventoryItemResponse,
  UpdateInventoryItemParams,
  UpdateInventoryItemBody,
  UpdateInventoryItemResponse,
  DeleteInventoryItemParams,
  ListWasteLogsQueryParams,
  ListWasteLogsResponse,
  CreateWasteLogBody,
  CreateWasteLogResponse,
} from "@workspace/api-zod";
import { getIO } from "../lib/socket";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES));

function tryEmitTo(room: string, event: string, data: unknown) {
  try { getIO().to(room).emit(event, data); } catch { /* ignore */ }
}

function mapItem(i: typeof inventoryItemsTable.$inferSelect) {
  const qty = Number(i.quantityOnHand);
  const threshold = Number(i.reorderThreshold);
  return {
    id: i.id,
    branchId: i.branchId,
    name: i.name,
    unit: i.unit,
    quantityOnHand: qty,
    reorderThreshold: threshold,
    reorderQuantity: Number(i.reorderQuantity),
    preferredSupplierId: i.preferredSupplierId ?? null,
    supplier: i.supplier ?? null,
    isLowStock: qty <= threshold && threshold > 0,
  };
}

/** Auto-generate a draft restock order if stock drops at or below reorder threshold */
async function checkAndAutoRestock(item: typeof inventoryItemsTable.$inferSelect) {
  const qty = Number(item.quantityOnHand);
  const threshold = Number(item.reorderThreshold);
  const reorderQty = Number(item.reorderQuantity);
  if (threshold <= 0 || qty > threshold || reorderQty <= 0) return;

  // Check if there's already a pending draft for this ingredient
  const existing = await db.select().from(restockOrdersTable)
    .where(and(eq(restockOrdersTable.ingredientId, item.id), eq(restockOrdersTable.status, "draft")));
  if (existing.length > 0) return; // already has a pending draft

  await db.insert(restockOrdersTable).values({
    branchId: item.branchId,
    ingredientId: item.id,
    quantity: String(reorderQty),
    supplierId: item.preferredSupplierId ?? null,
    status: "draft",
    notes: `Auto-generated: stock at ${qty} ${item.unit}, threshold ${threshold} ${item.unit}`,
  });

  tryEmitTo(`branch:${item.branchId}:admin`, "inventory:low_stock_restock", {
    ingredientId: item.id,
    name: item.name,
    quantity: qty,
    threshold,
    branchId: item.branchId,
  });
}

router.get("/inventory", async (req, res): Promise<void> => {
  const q = ListInventoryItemsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(inventoryItemsTable).orderBy(inventoryItemsTable.name);
  if (q.data.branchId) rows = rows.filter(i => i.branchId === q.data.branchId);
  if (q.data.lowStock) rows = rows.filter(i => Number(i.quantityOnHand) <= Number(i.reorderThreshold) && Number(i.reorderThreshold) > 0);
  res.json(ListInventoryItemsResponse.parse(rows.map(mapItem)));
});

router.post("/inventory", async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [i] = await db.insert(inventoryItemsTable).values({
    ...parsed.data,
    quantityOnHand: String(parsed.data.quantityOnHand),
    reorderThreshold: String(parsed.data.reorderThreshold),
  }).returning();
  res.status(201).json(CreateInventoryItemResponse.parse(mapItem(i)));
});

router.patch("/inventory/:id", async (req, res): Promise<void> => {
  const p = UpdateInventoryItemParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.quantityOnHand !== undefined) updateData.quantityOnHand = String(parsed.data.quantityOnHand);
  if (parsed.data.reorderThreshold !== undefined) updateData.reorderThreshold = String(parsed.data.reorderThreshold);
  if ((req.body as any).reorderQuantity !== undefined) updateData.reorderQuantity = String((req.body as any).reorderQuantity);
  if ((req.body as any).preferredSupplierId !== undefined) updateData.preferredSupplierId = (req.body as any).preferredSupplierId;
  const [i] = await db.update(inventoryItemsTable).set(updateData as any).where(eq(inventoryItemsTable.id, p.data.id)).returning();
  if (!i) { res.status(404).json({ error: "Item not found" }); return; }
  // Check if we need to auto-restock after quantity change
  if (parsed.data.quantityOnHand !== undefined) await checkAndAutoRestock(i);
  res.json(UpdateInventoryItemResponse.parse(mapItem(i)));
});

/** Decrement stock for an ingredient after order completion */
router.post("/inventory/decrement", async (req, res): Promise<void> => {
  const { ingredientId, quantity } = req.body;
  if (!ingredientId || !quantity) { res.status(400).json({ error: "ingredientId and quantity required" }); return; }
  const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, ingredientId));
  if (!item) { res.status(404).json({ error: "Ingredient not found" }); return; }
  const newQty = Math.max(0, Number(item.quantityOnHand) - Number(quantity));
  const [updated] = await db.update(inventoryItemsTable).set({ quantityOnHand: String(newQty) }).where(eq(inventoryItemsTable.id, ingredientId)).returning();
  await checkAndAutoRestock(updated);
  res.json(mapItem(updated));
});

router.delete("/inventory/:id", async (req, res): Promise<void> => {
  const p = DeleteInventoryItemParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, p.data.id));
  res.sendStatus(204);
});

router.get("/inventory/waste", async (req, res): Promise<void> => {
  const q = ListWasteLogsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(wasteLogsTable).orderBy(wasteLogsTable.createdAt);
  if (q.data.branchId) rows = rows.filter(w => w.branchId === q.data.branchId);
  const items = await db.select().from(inventoryItemsTable);
  const itemMap = new Map(items.map(i => [i.id, i.name]));
  res.json(ListWasteLogsResponse.parse(rows.map(w => ({
    id: w.id, branchId: w.branchId, ingredientId: w.ingredientId,
    ingredientName: itemMap.get(w.ingredientId) ?? null,
    quantity: Number(w.quantity), reason: w.reason, loggedBy: w.loggedBy ?? null,
    createdAt: w.createdAt.toISOString(),
  }))));
});

router.post("/inventory/waste", async (req, res): Promise<void> => {
  const parsed = CreateWasteLogBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [w] = await db.insert(wasteLogsTable).values({ ...parsed.data, quantity: String(parsed.data.quantity) }).returning();
  const item = (await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, w.ingredientId)))[0];
  // Decrement stock on waste log
  if (item) {
    const newQty = Math.max(0, Number(item.quantityOnHand) - parsed.data.quantity);
    const [updated] = await db.update(inventoryItemsTable).set({ quantityOnHand: String(newQty) }).where(eq(inventoryItemsTable.id, item.id)).returning();
    await checkAndAutoRestock(updated);
  }
  res.status(201).json(CreateWasteLogResponse.parse({
    id: w.id, branchId: w.branchId, ingredientId: w.ingredientId,
    ingredientName: item?.name ?? null, quantity: Number(w.quantity),
    reason: w.reason, loggedBy: w.loggedBy ?? null, createdAt: w.createdAt.toISOString(),
  }));
});

export default router;
