# TG's Restaurant ERP — ቲጂ ምግብ ቤት

Multi-branch Restaurant ERP platform for TG's Ethiopian Restaurant, Dubai UAE. Replaces WhatsApp-based chaos with a real-time command center covering orders, kitchen, deliveries, finance, inventory, payroll, lottery, and super admin oversight.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/tg-erp run dev` — run the React frontend (port 25390, proxied at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — seed the database with demo data

## Login Credentials (after seeding)

- **Super Admin**: `+251911001001` / `admin123`
- **Staff**:       `+251911001002` / `staff123`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind + shadcn/ui + wouter + TanStack Query + Recharts
- API: Express 5 + bcryptjs + jsonwebtoken
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec at lib/api-spec/openapi.yaml)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation
- `lib/db/src/schema/` — Drizzle schema: branches, users, menu, orders, deliveries, finance, inventory, payroll, lottery
- `artifacts/api-server/src/routes/` — Express route handlers (one file per module)
- `artifacts/tg-erp/src/pages/` — React pages (one file per page)

## Architecture decisions

- Contract-first: OpenAPI spec → codegen → typed hooks + server schemas. Never write raw fetch.
- JWT auth stored in localStorage, sent as `Authorization: Bearer`. No cookies.
- Numeric columns (price, salary, quantity) stored as `text` in Postgres via Drizzle `numeric` type — always convert to `String()` before insert.
- All routes mounted under `/api` via the shared reverse proxy; services never call each other directly.
- Kitchen and dashboard pages poll every 10-15s via `refetchInterval` on TanStack Query hooks.

## Modules

| Module | Frontend Route | API Prefix |
|---|---|---|
| Auth | /login | /api/auth |
| Dashboard | /dashboard | /api/dashboard |
| Orders | /orders | /api/orders |
| Kitchen (KDS) | /kitchen | /api/kitchen |
| Deliveries | /deliveries | /api/deliveries |
| Menu Management | /menu | /api/menu |
| Customers | /customers | /api/customers |
| Finance | /finance | /api/finance |
| Inventory | /inventory | /api/inventory |
| Payroll | /payroll | /api/payroll |
| Lottery | /lottery | /api/lottery |
| Staff | /staff | /api/users |
| Branches | /branches | /api/branches |
| Customer Tracker | /track/:code | /api/orders/by-code/:code |
| Public Menu | /menu-public | /api/menu |

## User preferences

- Ethiopian-inspired dark UI: amber/terracotta/gold on deep charcoal
- Ethiopian + Arabic bilingual menu items (nameEn + nameAm)
- Currency in AED (UAE Dirhams)
- No emojis in the UI

## Gotchas

- Drizzle `numeric` columns require string values on insert/update — always `String(num)` before insert.
- Always rebuild lib declarations (`pnpm run typecheck:libs`) after changing db schema files.
- Run `pnpm --filter @workspace/db run push` after schema changes before starting the server.
- When adding queryKey to hook options, use the generated `getXxxQueryKey()` helper — it's required by the type.
- The `@workspace/api-client-react` package exports `setAuthTokenGetter` from its main index — do not import from `/src/custom-fetch` directly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `lib/api-spec/openapi.yaml` for all API contracts

## Replit Setup Status (completed 2026-07-06)

This project has been fully set up and verified on Replit:

### Environment secrets configured
All required secrets are present in Replit Secrets:
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `LOG_LEVEL`, `NODE_ENV`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (Twilio set to `placeholder` until real credentials provided).
`DATABASE_URL` is runtime-managed by Replit's built-in PostgreSQL.

### Database
- Replit's built-in PostgreSQL provisioned and reachable
- Schema pushed via `pnpm --filter @workspace/db run push` — 32 tables created
- Demo data seeded via `pnpm --filter @workspace/scripts run seed`

### Seeded accounts
| Role | Phone | Password |
|---|---|---|
| super_admin | +251911001001 | admin123 |
| branch_manager | +251911001002 | staff123 |
| kitchen_staff | +251911001003 | staff123 |
| delivery_staff | +251911001004 | staff123 |
| order_staff | +251911001005 | staff123 |
| branch_manager | +251911001006 | staff123 |

### Workflow
`TG Restaurant ERP` workflow runs both services in parallel:
- API server: Express + Socket.IO on port **8080**
- Frontend: Vite + React on port **25390**

### Portal verification results
| Portal | URL | Login Gate | API Auth |
|---|---|---|---|
| Admin Command Center | `/` | ✅ login screen | ✅ 200 with admin JWT |
| Chef Portal | `/chef` | ✅ login screen | ✅ 200 on /api/kitchen/queue |
| Deliveryman Portal | `/delivery` | ✅ login screen | ✅ 200 on /api/menu/items |
| Addis Portal | `/addis` | ✅ login screen | ✅ 200 on /api/addis/shipments |
| Customer Webapp | `/menu-public` | ✅ no login, menu loads | ✅ public route |

### Security verification results
- Chef JWT → `GET /api/users` → **403** ✅ (role-blocked server-side)
- Chef JWT → `GET /api/kitchen/queue` → **200** ✅ (correct access)
- Delivery JWT → `GET /api/menu/items` → **200** ✅
- Delivery JWT → `GET /api/users` → **401** ✅ (unauthenticated path blocked)
- Wrong password ×5 on any account → **account locked** with countdown message ✅

### Known pre-existing issues (tracked as follow-up tasks)
- JWT secret has a hardcoded fallback string in `artifacts/api-server/src/middlewares/auth.ts` — tracked as Task #2
- Role name mismatch `order_staff` (DB) vs `order_intake` (frontend layout) breaks Order Queue nav — tracked as Task #3
- Twilio/SendGrid credentials are placeholders; notifications don't send — tracked as Task #4
