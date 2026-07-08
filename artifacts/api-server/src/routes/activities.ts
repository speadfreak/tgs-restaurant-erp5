import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, staffActivitiesTable, usersTable, recordNotesTable } from "@workspace/db";
import { getIO } from "../lib/socket";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(["/activities", "/notes"], authenticate, requireRole(...ADMIN_ROLES));

function tryEmitTo(room: string, event: string, data: unknown) {
  try { getIO().to(room).emit(event, data); } catch { /* ignore */ }
}

function buildActivity(a: typeof staffActivitiesTable.$inferSelect, assignedTo?: { name: string } | null, assignedBy?: { name: string } | null) {
  return {
    id: a.id,
    assignedToUserId: a.assignedToUserId,
    assignedToName: assignedTo?.name ?? null,
    assignedByUserId: a.assignedByUserId ?? null,
    assignedByName: assignedBy?.name ?? null,
    branchId: a.branchId,
    title: a.title,
    dueDate: a.dueDate ?? null,
    status: a.status,
    relatedEntityType: a.relatedEntityType ?? null,
    relatedEntityId: a.relatedEntityId ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/activities", async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : null;
  const status = req.query.status as string | undefined;
  let rows = await db.select().from(staffActivitiesTable).orderBy(staffActivitiesTable.createdAt);
  if (branchId) rows = rows.filter(a => a.branchId === branchId);
  if (userId) rows = rows.filter(a => a.assignedToUserId === userId);
  if (status) rows = rows.filter(a => a.status === status);
  const userIds = [...new Set([...rows.map(a => a.assignedToUserId), ...rows.map(a => a.assignedByUserId).filter(Boolean)])];
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));
  res.json(rows.map(a => buildActivity(a, userMap.get(a.assignedToUserId), a.assignedByUserId ? userMap.get(a.assignedByUserId!) : null)));
});

router.post("/activities", async (req, res): Promise<void> => {
  const { assignedToUserId, assignedByUserId, branchId, title, dueDate, relatedEntityType, relatedEntityId } = req.body;
  if (!assignedToUserId || !branchId || !title) {
    res.status(400).json({ error: "assignedToUserId, branchId, title required" }); return;
  }
  const [a] = await db.insert(staffActivitiesTable).values({
    assignedToUserId, assignedByUserId: assignedByUserId ?? null, branchId, title,
    dueDate: dueDate ?? null,
    relatedEntityType: relatedEntityType ?? null,
    relatedEntityId: relatedEntityId ?? null,
    status: "pending",
  }).returning();
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));
  const result = buildActivity(a, userMap.get(a.assignedToUserId), a.assignedByUserId ? userMap.get(a.assignedByUserId!) : null);
  tryEmitTo(`user:${assignedToUserId}`, "activity:assigned", result);
  res.status(201).json(result);
});

router.patch("/activities/:id/done", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [a] = await db.update(staffActivitiesTable).set({ status: "done" }).where(eq(staffActivitiesTable.id, id)).returning();
  if (!a) { res.status(404).json({ error: "Activity not found" }); return; }
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));
  res.json(buildActivity(a, userMap.get(a.assignedToUserId), a.assignedByUserId ? userMap.get(a.assignedByUserId!) : null));
});

router.delete("/activities/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(staffActivitiesTable).where(eq(staffActivitiesTable.id, id));
  res.sendStatus(204);
});

// Record notes (activity timeline "chatter")
router.get("/notes", async (req, res): Promise<void> => {
  const { entityType, entityId } = req.query;
  if (!entityType || !entityId) { res.status(400).json({ error: "entityType and entityId required" }); return; }
  const rows = await db.select().from(recordNotesTable)
    .where(and(eq(recordNotesTable.entityType, entityType as string), eq(recordNotesTable.entityId, parseInt(entityId as string, 10))))
    .orderBy(recordNotesTable.createdAt);
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));
  res.json(rows.map(n => ({
    id: n.id, entityType: n.entityType, entityId: n.entityId,
    authorId: n.authorId ?? null, authorName: n.authorId ? (userMap.get(n.authorId)?.name ?? null) : null,
    note: n.note, createdAt: n.createdAt.toISOString(),
  })));
});

router.post("/notes", async (req, res): Promise<void> => {
  const { entityType, entityId, authorId, note } = req.body;
  if (!entityType || !entityId || !note) {
    res.status(400).json({ error: "entityType, entityId, note required" }); return;
  }
  const [n] = await db.insert(recordNotesTable).values({ entityType, entityId: parseInt(entityId, 10), authorId: authorId ?? null, note }).returning();
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));
  res.status(201).json({
    id: n.id, entityType: n.entityType, entityId: n.entityId,
    authorId: n.authorId ?? null, authorName: n.authorId ? (userMap.get(n.authorId)?.name ?? null) : null,
    note: n.note, createdAt: n.createdAt.toISOString(),
  });
});

export default router;
