---
name: Render deployment layout
description: Key non-obvious facts about deploying this monorepo to Render + Neon.
---

## Frontend build output
`vite.config.ts` sets `build.outDir` to `dist/public` (not the default `dist`).
`render.yaml` must use `staticPublishPath: dist/public`.

## Backend entry point
esbuild outputs `dist/index.mjs` (ESM, not CJS). The start command is:
`node --enable-source-maps ./dist/index.mjs`

## CORS / Socket.IO
Both Express CORS and Socket.IO CORS read from `FRONTEND_URL` env var (comma-separated list).
When `NODE_ENV=production` and `FRONTEND_URL` is unset, the allowed-origins list is intentionally empty (fail closed). Localhost fallback only applies in development.

**Why:** An unset `FRONTEND_URL` in production would otherwise silently allow localhost origins, masking deployment misconfiguration while blocking real browser clients.

## Database SSL (Neon)
Use `ssl: true` (full certificate verification, not `rejectUnauthorized: false`).
Neon uses certs from trusted CAs so full verification is safe and more secure.

## VITE_API_URL
Set this in Render's static site environment variables to the backend service URL.
Frontend `main.tsx` calls `setBaseUrl(VITE_API_URL)` — only when truthy (trimmed).
Socket hook also reads it — falls back to `window.location.origin` only when unset/empty.
In dev, leave it unset to use the Vite proxy, or set to `http://localhost:8080` for direct connection.

## Root convenience scripts
`pnpm run build:api` / `build:web` / `start:api` / `db:push` / `db:seed` are wired up.

## render.yaml env vars
All required: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, SETTINGS_ENCRYPTION_KEY, FRONTEND_URL, SESSION_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
Note: env var is `TWILIO_WHATSAPP_FROM` (not `TWILIO_WHATSAPP_NUMBER`).
