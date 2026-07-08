---
name: Express router mount-order role gate bug
description: Blanket router.use(authenticate, requireRole(...)) with no path arg leaks across sibling routers mounted later
---

In a chain of `router.use(subRouter)` mounts with no path prefix (e.g. `routes/index.ts` mounting users/finance/inventory/payroll/etc.), a sub-router's own `router.use(authenticate, requireRole(...))` declared with **no path argument** matches every path passed into it — not just its own routes. Since Express walks mounted routers in registration order, a role gate in an earlier-mounted router (e.g. `usersRouter`, ADMIN_ROLES only) will 403 requests meant for a later-mounted router (e.g. `financeRouter`) before they ever get there, for any role not in the earlier gate's allow-list.

**Why:** Caused a real production bug in TG's Restaurant ERP — `finance_staff` could never reach `/api/finance/entries` because `usersRouter`'s blanket ADMIN-only gate (mounted first) intercepted the request first. Same pattern existed across ~13 route files (users, customers, deliveries, finance, inventory, payroll, lottery, dashboard, suppliers, restock, activities, cron-status, audit, audit-xlsx, settings).

**How to apply:** Whenever you see `router.use(authenticate, requireRole(...))` with no path, and that router is mounted without a prefix alongside sibling routers, add the router's own path prefix (or an array of prefixes, e.g. `["/activities", "/notes"]`) as the first argument: `router.use("/finance", authenticate, requireRole(...))`. Verify by hitting each role's real endpoints end-to-end after any new router is added to the chain — a route "existing" and returning the wrong 403 is easy to miss without live requests.
