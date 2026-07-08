import { db, branchesTable, usersTable, menuCategoriesTable, menuItemsTable, customersTable, inventoryItemsTable, expensesTable } from "@workspace/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding database...");

  // ── Branches ─────────────────────────────────────────────────────────────────
  // Use an existence check since branchesTable has no unique text constraint.
  const existingBranches = await db.select().from(branchesTable).orderBy(branchesTable.id);
  let b1: typeof branchesTable.$inferSelect;
  let b2: typeof branchesTable.$inferSelect;

  if (existingBranches.length >= 2) {
    [b1, b2] = existingBranches as [typeof branchesTable.$inferSelect, typeof branchesTable.$inferSelect];
    console.log("Branches already seeded, skipping");
  } else {
    const inserted = await db.insert(branchesTable).values([
      { name: "TG Deira",    address: "Deira, Dubai, UAE",    phone: "+97142001001", active: true },
      { name: "TG Bur Dubai", address: "Bur Dubai, Dubai, UAE", phone: "+97142001002", active: true },
    ]).returning();
    [b1, b2] = inserted as [typeof branchesTable.$inferSelect, typeof branchesTable.$inferSelect];
    console.log("Branches seeded");
  }

  // ── Users ─────────────────────────────────────────────────────────────────────
  // usersTable has a unique constraint on phone, so onConflictDoNothing works correctly.
  const adminHash = await bcrypt.hash("admin123", 10);
  const staffHash = await bcrypt.hash("staff123", 10);

  await db.insert(usersTable).values([
    { name: "Tigist Haile",   phone: "+251911001001", role: "super_admin",    passwordHash: adminHash, active: true },
    { name: "Kebede Alemu",   phone: "+251911001002", role: "branch_manager", passwordHash: staffHash, branchId: b1.id, baseSalary: "3500", active: true },
    { name: "Meron Tadesse",  phone: "+251911001003", role: "kitchen_staff",  passwordHash: staffHash, branchId: b1.id, baseSalary: "2500", active: true },
    { name: "Solomon Bekele", phone: "+251911001004", role: "delivery_staff", passwordHash: staffHash, branchId: b1.id, baseSalary: "2000", active: true },
    { name: "Hana Girma",     phone: "+251911001005", role: "order_staff",    passwordHash: staffHash, branchId: b2.id, baseSalary: "2200", active: true },
    { name: "Dawit Tesfaye",  phone: "+251911001006", role: "branch_manager", passwordHash: staffHash, branchId: b2.id, baseSalary: "3500", active: true },
    { name: "Selam Kebede",   phone: "+251911001007", role: "addis_staff",    passwordHash: staffHash, branchId: null, baseSalary: "2000", active: true },
    { name: "Mulu Worku",     phone: "+251911001008", role: "finance_staff",  passwordHash: staffHash, branchId: b1.id, baseSalary: "2800", active: true },
  ]).onConflictDoNothing(); // unique on phone
  console.log("Users seeded");

  // ── Menu Categories ───────────────────────────────────────────────────────────
  // No unique constraint — check for existence first.
  const existingCats = await db.select().from(menuCategoriesTable).orderBy(menuCategoriesTable.sortOrder);
  let catMain: typeof menuCategoriesTable.$inferSelect | undefined;
  let catVeg: typeof menuCategoriesTable.$inferSelect | undefined;
  let catDrinks: typeof menuCategoriesTable.$inferSelect | undefined;
  let catDesserts: typeof menuCategoriesTable.$inferSelect | undefined;

  if (existingCats.length >= 4) {
    [catMain, catVeg, catDrinks, catDesserts] = existingCats as typeof existingCats;
    console.log("Menu categories already seeded, skipping");
  } else {
    const cats = await db.insert(menuCategoriesTable).values([
      { nameEn: "Main Dishes", nameAm: "ዋና ምግቦች",  sortOrder: 1 },
      { nameEn: "Vegetarian",  nameAm: "የጾም ምግቦች",  sortOrder: 2 },
      { nameEn: "Drinks",      nameAm: "መጠጦች",      sortOrder: 3 },
      { nameEn: "Desserts",    nameAm: "ጣፋጭ ምግቦች", sortOrder: 4 },
    ]).returning();
    [catMain, catVeg, catDrinks, catDesserts] = cats;
    console.log("Categories seeded");
  }

  // ── Menu Items ────────────────────────────────────────────────────────────────
  const existingItems = await db.select({ id: menuItemsTable.id }).from(menuItemsTable);
  if (existingItems.length === 0 && catMain) {
    await db.insert(menuItemsTable).values([
      { categoryId: catMain.id,     nameEn: "Doro Wat",               nameAm: "ዶሮ ወጥ",   description: "Ethiopian spiced chicken stew with boiled egg",    priceAed: "65", available: true },
      { categoryId: catMain.id,     nameEn: "Tibs",                   nameAm: "ጥብስ",      description: "Sauteed beef or lamb with vegetables",            priceAed: "70", available: true },
      { categoryId: catMain.id,     nameEn: "Kitfo",                  nameAm: "ክትፎ",      description: "Minced raw beef with Ethiopian butter and spices", priceAed: "75", available: true },
      { categoryId: catMain.id,     nameEn: "Zigni",                  nameAm: "ዝግኒ",      description: "Spiced beef stew with berbere sauce",             priceAed: "68", available: true },
      { categoryId: catMain.id,     nameEn: "Beyaynetu (Mixed Platter)", nameAm: "በያይነቱ", description: "Mixed selection of stews served on injera",        priceAed: "85", available: true },
      { categoryId: catVeg!.id,     nameEn: "Misir Wat",              nameAm: "ምስር ወጥ",  description: "Red lentil stew with berbere",                     priceAed: "45", available: true },
      { categoryId: catVeg!.id,     nameEn: "Gomen",                  nameAm: "ጎመን",      description: "Ethiopian collard greens cooked with spices",     priceAed: "40", available: true },
      { categoryId: catVeg!.id,     nameEn: "Shiro",                  nameAm: "ሽሮ",       description: "Chickpea flour stew with berbere",                priceAed: "42", available: true },
      { categoryId: catVeg!.id,     nameEn: "Injera Plate",           nameAm: "ዳቦ ወጥ",   description: "Full vegetarian plate with seasonal vegetables",   priceAed: "55", available: true },
      { categoryId: catDrinks!.id,  nameEn: "Ethiopian Coffee",       nameAm: "ቡና",       description: "Traditional Ethiopian coffee ceremony",           priceAed: "25", available: true },
      { categoryId: catDrinks!.id,  nameEn: "Tej (Honey Wine)",       nameAm: "ጠጅ",       description: "Traditional Ethiopian honey mead",               priceAed: "30", available: true },
      { categoryId: catDrinks!.id,  nameEn: "Fresh Juice",            nameAm: "ጭማቂ",      description: "Seasonal fresh fruit juice",                     priceAed: "20", available: true },
      { categoryId: catDesserts!.id, nameEn: "Teff Cake",             nameAm: "ጤፍ ኬክ",   description: "Gluten-free cake made with teff flour",            priceAed: "28", available: true },
    ]);
    console.log("Menu items seeded");
  } else {
    console.log("Menu items already seeded, skipping");
  }

  // ── Customers ─────────────────────────────────────────────────────────────────
  // customersTable has no unique constraint — check first.
  const existingCustomers = await db.select({ id: customersTable.id }).from(customersTable);
  if (existingCustomers.length === 0) {
    await db.insert(customersTable).values([
      { name: "Ahmed Al Rashid", phone: "+971501234567", address: "Al Rigga, Dubai" },
      { name: "Fatima Mohammed", phone: "+971502345678", address: "Deira, Dubai" },
      { name: "Abebe Girma",     phone: "+251912345678", address: "Near TG Deira" },
      { name: "Aisha Osman",     phone: "+971503456789", address: "Bur Dubai" },
      { name: "Yonas Tadesse",   phone: "+251913456789", address: "Online Customer" },
    ]);
    console.log("Customers seeded");
  } else {
    console.log("Customers already seeded, skipping");
  }

  // ── Inventory ─────────────────────────────────────────────────────────────────
  const existingInventory = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable);
  if (existingInventory.length === 0) {
    await db.insert(inventoryItemsTable).values([
      { branchId: b1.id, name: "Berbere Spice",          unit: "kg",     quantityOnHand: "5",   reorderThreshold: "2",  supplier: "Ethiopian Spice Co" },
      { branchId: b1.id, name: "Injera",                 unit: "pieces", quantityOnHand: "120", reorderThreshold: "50", supplier: "Local Baker" },
      { branchId: b1.id, name: "Chicken",                unit: "kg",     quantityOnHand: "8",   reorderThreshold: "5",  supplier: "Dubai Poultry" },
      { branchId: b1.id, name: "Beef",                   unit: "kg",     quantityOnHand: "12",  reorderThreshold: "8",  supplier: "Dubai Meat Market" },
      { branchId: b1.id, name: "Red Lentils",            unit: "kg",     quantityOnHand: "3",   reorderThreshold: "4",  supplier: "Wholesale Foods" },
      { branchId: b1.id, name: "Ethiopian Coffee Beans", unit: "kg",     quantityOnHand: "6",   reorderThreshold: "3",  supplier: "Harar Coffee" },
      { branchId: b2.id, name: "Berbere Spice",          unit: "kg",     quantityOnHand: "4",   reorderThreshold: "2",  supplier: "Ethiopian Spice Co" },
      { branchId: b2.id, name: "Injera",                 unit: "pieces", quantityOnHand: "30",  reorderThreshold: "50", supplier: "Local Baker" },
      { branchId: b2.id, name: "Beef",                   unit: "kg",     quantityOnHand: "7",   reorderThreshold: "8",  supplier: "Dubai Meat Market" },
    ]);
    console.log("Inventory seeded");
  } else {
    console.log("Inventory already seeded, skipping");
  }

  // ── Expenses ─────────────────────────────────────────────────────────────────
  const existingExpenses = await db.select({ id: expensesTable.id }).from(expensesTable);
  if (existingExpenses.length === 0) {
    await db.insert(expensesTable).values([
      { branchId: b1.id, category: "Rent",      amountAed: "15000", description: "Monthly rent - Deira branch" },
      { branchId: b1.id, category: "Utilities", amountAed: "2500",  description: "Electricity and water bill" },
      { branchId: b1.id, category: "Supplies",  amountAed: "3200",  description: "Kitchen supplies restocking" },
      { branchId: b2.id, category: "Rent",      amountAed: "18000", description: "Monthly rent - Bur Dubai branch" },
      { branchId: b2.id, category: "Utilities", amountAed: "2800",  description: "Electricity and water bill" },
    ]);
    console.log("Expenses seeded");
  } else {
    console.log("Expenses already seeded, skipping");
  }

  console.log("\n✅ Seed complete!");
  console.log("Login credentials:");
  console.log("  Super Admin:   +251911001001 / admin123");
  console.log("  Branch Mgr:    +251911001002 / staff123");
  console.log("  Chef:          +251911001003 / staff123");
  console.log("  Delivery:      +251911001004 / staff123");
  console.log("  Order Staff:   +251911001005 / staff123");
  console.log("  Addis Staff:   +251911001007 / staff123");
  console.log("  Finance Staff: +251911001008 / staff123");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
