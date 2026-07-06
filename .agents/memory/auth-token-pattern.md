---
name: Auth token pattern
description: How JWT auth is wired in TG ERP frontend
---

JWT is stored in `localStorage` under key `tg_erp_token`. On login, `setAuthTokenGetter` is called with a getter that reads from localStorage.

`setAuthTokenGetter` is exported from the **main index** of `@workspace/api-client-react`:
```ts
import { setAuthTokenGetter } from "@workspace/api-client-react";
```
Do NOT import from `@workspace/api-client-react/src/custom-fetch` — the package only exports `.` (its root), and that sub-path import fails TypeScript.

**Why:** The package.json only has `"exports": { ".": "./src/index.ts" }`. Sub-path imports are blocked.
