---
name: Finance entries authorization
description: Branching rules for the finance_entries table and FINANCE_ROLES gate
---

# Finance entries authorization rules

Finance entries routes use `FINANCE_ROLES = ["finance_staff", "super_admin", "branch_manager"]`.

- `finance_staff` without a `branchId` on their user row → 403 immediately on all endpoints.
- `finance_staff` is always hard-scoped to their own `branchId` — they cannot list, create, or edit entries from other branches, regardless of query params.
- Admins (`ADMIN_ROLES`) can cross-branch filter via `?branchId=`.
- Edit within 24h / delete within 1h for non-admins; `isLocked` flag blocks both for anyone below admin.

**Why:** prevent cross-branch data leakage via a misconfigured unassigned account.

**How to apply:** any future finance route that returns or mutates financeEntriesTable must check `!isAdmin && !req.user.branchId` before processing.
