import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, restockOrdersTable, inventoryItemsTable, suppliersTable } from "@workspace/db";
import { getIO } from "../lib/socket";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES));

function tryEmitTo(room: string, event: string, data: unknown) {
  try { getIO().to(room).emit(event, data); } catch { /* ignore */ }
}

async function buildRestock(r: typeof restockOrdersTable.$inferSelect) {
  const ingredient = (await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, r.ingredientId)))[0];
  const supplier = r.supplierId
    ? (await db.select().from(suppliersTable).where(eq(suppliersTable.id, r.supplierId)))[0]
    : null;
  return {
    id: r.id,
    branchId: r.branchId,
    ingredientId: r.ingredientId,
    ingredientName: ingredient?.name ?? null,
    ingredientUnit: ingredient?.unit ?? null,
    quantity: Number(r.quantity),
    supplierId: r.supplierId ?? null,
    supplierName: supplier?.name ?? null,
    supplierPhone: supplier?.phone ?? null,
    status: r.status,
    notes: r.notes ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/restock", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const status = req.query.status as string | undefined;
  let rows = await db.select().from(restockOrdersTable).orderBy(restockOrdersTable.createdAt);
  if (branchId) rows = rows.filter(r => r.branchId === branchId);
  if (status) rows = rows.filter(r => r.status === status);
  res.json(await Promise.all(rows.map(buildRestock)));
});

router.post("/restock", async (req, res): Promise<void> => {
  const { branchId, ingredientId, quantity, supplierId, notes } = req.body;
  if (!branchId || !ingredientId || !quantity) {
    res.status(400).json({ error: "branchId, ingredientId, quantity required" }); return;
  }
  const [r] = await db.insert(restockOrdersTable).values({
    branchId, ingredientId, quantity: String(quantity),
    supplierId: supplierId ?? null, notes: notes ?? null, status: "draft",
  }).returning();
  res.status(201).json(await buildRestock(r));
});

router.patch("/restock/:id/approve", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [r] = await db.update(restockOrdersTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(restockOrdersTable.id, id), eq(restockOrdersTable.status, "draft")))
    .returning();
  if (!r) { res.status(404).json({ error: "Draft restock order not found" }); return; }
  res.json(await buildRestock(r));
});

router.patch("/restock/:id/receive", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [r] = await db.update(restockOrdersTable)
    .set({ status: "received", receivedAt: new Date() })
    .where(and(eq(restockOrdersTable.id, id), eq(restockOrdersTable.status, "approved")))
    .returning();
  if (!r) { res.status(404).json({ error: "Approved restock order not found" }); return; }
  // Increment inventory on receipt
  const item = (await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, r.ingredientId)))[0];
  if (item) {
    const newQty = Number(item.quantityOnHand) + Number(r.quantity);
    await db.update(inventoryItemsTable).set({ quantityOnHand: String(newQty) }).where(eq(inventoryItemsTable.id, item.id));
    tryEmitTo(`branch:${r.branchId}:admin`, "inventory:updated", { ingredientId: item.id, name: item.name, newQuantity: newQty });
  }
  res.json(await buildRestock(r));
});

router.delete("/restock/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(restockOrdersTable).where(and(eq(restockOrdersTable.id, id), eq(restockOrdersTable.status, "draft")));
  res.sendStatus(204);
});

export default router;
