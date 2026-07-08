---
name: Express 5 OPTIONS wildcard and seed patterns
description: Express 5 route patterns and safe seed idempotency patterns
---

# Express 5 CORS OPTIONS route

`app.options('*', cors(corsOptions))` works in Express 5.2.1 without startup errors.
`corsOptions` shared between `app.options()` and `app.use(cors())` is correct and recommended.

# Seed idempotency without unique constraints

Tables like branches, menu_categories, menu_items, customers, inventory_items, expenses have no unique
text column — `onConflictDoNothing()` without a target will silently insert duplicates.

**Pattern:** check `db.select({ id }).from(table)` first and skip insert if `length > 0`.

Only `usersTable` can use `onConflictDoNothing()` reliably (it has `unique(phone)`).

**Why:** Discovered when seed was re-run on Neon production DB and duplicated menu items.
