---
name: DB lib rebuild
description: Must rebuild lib declarations after schema changes or imports appear missing
---

When new tables/exports are added to `lib/db/src/schema/` (or any `lib/*` composite package), the TypeScript declaration files (.d.ts) are stale until explicitly rebuilt.

**Symptom:** `@workspace/api-server` typecheck fails with "Module '@workspace/db' has no exported member 'fooTable'" even though the export exists in source.

**Fix:** Run `pnpm run typecheck:libs` (calls `tsc --build`) to rebuild all composite lib declarations. Then leaf package typechecks will see the new exports.

**Why:** Composite libs use incremental compilation and emit declarations to their `dist/` folder. Leaf packages import from those emitted declarations, not from source directly.

**How to apply:** Any time you add a new schema file or change exports in a `lib/*` package, run `pnpm run typecheck:libs` before typechecking artifact packages.
