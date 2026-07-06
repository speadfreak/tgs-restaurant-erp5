import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, menuCategoriesTable, menuItemsTable } from "@workspace/db";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";
import {
  ListMenuCategoriesQueryParams,
  ListMenuCategoriesResponse,
  CreateMenuCategoryBody,
  CreateMenuCategoryResponse,
  UpdateMenuCategoryParams,
  UpdateMenuCategoryBody,
  UpdateMenuCategoryResponse,
  DeleteMenuCategoryParams,
  ListMenuItemsQueryParams,
  ListMenuItemsResponse,
  CreateMenuItemBody,
  CreateMenuItemResponse,
  GetMenuItemParams,
  GetMenuItemResponse,
  UpdateMenuItemParams,
  UpdateMenuItemBody,
  UpdateMenuItemResponse,
  DeleteMenuItemParams,
} from "@workspace/api-zod";

const router: Router = Router();

function mapCategory(c: typeof menuCategoriesTable.$inferSelect) {
  return { id: c.id, branchId: c.branchId ?? null, nameEn: c.nameEn, nameAm: c.nameAm, sortOrder: c.sortOrder };
}

function mapItem(i: typeof menuItemsTable.$inferSelect, categoryName?: string | null) {
  return {
    id: i.id,
    categoryId: i.categoryId,
    nameEn: i.nameEn,
    nameAm: i.nameAm,
    description: i.description ?? null,
    priceAed: Number(i.priceAed),
    photoUrl: i.photoUrl ?? null,
    available: i.available,
    categoryName: categoryName ?? null,
  };
}

// CATEGORIES
router.get("/menu/categories", async (req, res): Promise<void> => {
  const q = ListMenuCategoriesQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  let rows = await db.select().from(menuCategoriesTable).orderBy(menuCategoriesTable.sortOrder);
  // Include global (null branchId) categories AND branch-specific ones
  if (q.data.branchId) rows = rows.filter(c => c.branchId === q.data.branchId || c.branchId === null);
  res.json(ListMenuCategoriesResponse.parse(rows.map(mapCategory)));
});

router.post("/menu/categories", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const parsed = CreateMenuCategoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [c] = await db.insert(menuCategoriesTable).values(parsed.data).returning();
  res.status(201).json(CreateMenuCategoryResponse.parse(mapCategory(c)));
});

router.patch("/menu/categories/:id", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const p = UpdateMenuCategoryParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateMenuCategoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [c] = await db.update(menuCategoriesTable).set(parsed.data).where(eq(menuCategoriesTable.id, p.data.id)).returning();
  if (!c) { res.status(404).json({ error: "Category not found" }); return; }
  res.json(UpdateMenuCategoryResponse.parse(mapCategory(c)));
});

router.delete("/menu/categories/:id", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const p = DeleteMenuCategoryParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(menuCategoriesTable).where(eq(menuCategoriesTable.id, p.data.id));
  res.sendStatus(204);
});

// ITEMS
router.get("/menu/items", async (req, res): Promise<void> => {
  const q = ListMenuItemsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const categories = await db.select().from(menuCategoriesTable);
  const catMap = new Map(categories.map(c => [c.id, c.nameEn]));
  let rows = await db.select().from(menuItemsTable).orderBy(menuItemsTable.id);
  if (q.data.categoryId) rows = rows.filter(i => i.categoryId === q.data.categoryId);
  if (q.data.available !== undefined) rows = rows.filter(i => i.available === q.data.available);
  res.json(ListMenuItemsResponse.parse(rows.map(i => mapItem(i, catMap.get(i.categoryId)))));
});

router.post("/menu/items", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const parsed = CreateMenuItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [i] = await db.insert(menuItemsTable).values({ ...parsed.data, priceAed: String(parsed.data.priceAed) }).returning();
  res.status(201).json(CreateMenuItemResponse.parse(mapItem(i)));
});

router.get("/menu/items/:id", async (req, res): Promise<void> => {
  const p = GetMenuItemParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [i] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, p.data.id));
  if (!i) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(GetMenuItemResponse.parse(mapItem(i)));
});

router.patch("/menu/items/:id", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const p = UpdateMenuItemParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const parsed = UpdateMenuItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.priceAed !== undefined) updateData.priceAed = String(parsed.data.priceAed);
  const [i] = await db.update(menuItemsTable).set(updateData as any).where(eq(menuItemsTable.id, p.data.id)).returning();
  if (!i) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(UpdateMenuItemResponse.parse(mapItem(i)));
});

router.delete("/menu/items/:id", authenticate, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const p = DeleteMenuItemParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(menuItemsTable).where(eq(menuItemsTable.id, p.data.id));
  res.sendStatus(204);
});

export default router;
