import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, branchesTable } from "@workspace/db";
import {
  ListBranchesResponse,
  CreateBranchBody,
  CreateBranchResponse,
  GetBranchParams,
  GetBranchResponse,
  UpdateBranchParams,
  UpdateBranchBody,
  UpdateBranchResponse,
  DeleteBranchParams,
} from "@workspace/api-zod";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();

function mapBranch(b: typeof branchesTable.$inferSelect) {
  return { id: b.id, name: b.name, address: b.address, phone: b.phone, active: b.active, createdAt: b.createdAt.toISOString() };
}

// GET /branches — any authenticated staff can read the branch list (needed by addis supply forms, portals, etc.)
router.get("/branches", authenticate, async (_req, res): Promise<void> => {
  const rows = await db.select().from(branchesTable).orderBy(branchesTable.id);
  res.json(ListBranchesResponse.parse(rows.map(mapBranch)));
});

router.post("/branches", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const parsed = CreateBranchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [b] = await db.insert(branchesTable).values(parsed.data).returning();
  res.status(201).json(CreateBranchResponse.parse(mapBranch(b)));
});

router.get("/branches/:id", authenticate, async (req, res): Promise<void> => {
  const p = GetBranchParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [b] = await db.select().from(branchesTable).where(eq(branchesTable.id, p.data.id));
  if (!b) { res.status(404).json({ error: "Branch not found" }); return; }
  res.json(GetBranchResponse.parse(mapBranch(b)));
});

router.patch("/branches/:id", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const p = UpdateBranchParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateBranchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [b] = await db.update(branchesTable).set(parsed.data).where(eq(branchesTable.id, p.data.id)).returning();
  if (!b) { res.status(404).json({ error: "Branch not found" }); return; }
  res.json(UpdateBranchResponse.parse(mapBranch(b)));
});

router.delete("/branches/:id", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const p = DeleteBranchParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(branchesTable).where(eq(branchesTable.id, p.data.id));
  res.sendStatus(204);
});

export default router;
