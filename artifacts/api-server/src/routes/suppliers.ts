import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, suppliersTable } from "@workspace/db";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use("/suppliers", authenticate, requireRole(...ADMIN_ROLES));

router.get("/suppliers", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  let rows = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  if (branchId) rows = rows.filter(s => s.branchId === branchId);
  res.json(rows.map(s => ({
    id: s.id, branchId: s.branchId, name: s.name,
    phone: s.phone ?? null, contactEmail: s.contactEmail ?? null,
    createdAt: s.createdAt.toISOString(),
  })));
});

router.post("/suppliers", async (req, res): Promise<void> => {
  const { branchId, name, phone, contactEmail } = req.body;
  if (!branchId || !name) { res.status(400).json({ error: "branchId and name required" }); return; }
  const [s] = await db.insert(suppliersTable).values({ branchId, name, phone: phone ?? null, contactEmail: contactEmail ?? null }).returning();
  res.status(201).json({ id: s.id, branchId: s.branchId, name: s.name, phone: s.phone ?? null, contactEmail: s.contactEmail ?? null, createdAt: s.createdAt.toISOString() });
});

router.patch("/suppliers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, phone, contactEmail } = req.body;
  const [s] = await db.update(suppliersTable).set({ name, phone: phone ?? null, contactEmail: contactEmail ?? null }).where(eq(suppliersTable.id, id)).returning();
  if (!s) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json({ id: s.id, branchId: s.branchId, name: s.name, phone: s.phone ?? null, contactEmail: s.contactEmail ?? null, createdAt: s.createdAt.toISOString() });
});

router.delete("/suppliers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(suppliersTable).where(eq(suppliersTable.id, id));
  res.sendStatus(204);
});

export default router;
