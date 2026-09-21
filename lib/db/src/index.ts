import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Enable SSL in production so the connection to hosted Postgres (Neon,
// Supabase, etc.) is encrypted. Full chain verification is left off
// (rejectUnauthorized: false) because managed providers like Supabase's
// connection pooler present certificate chains Node's default trusted-CA
// store does not fully validate (SELF_SIGNED_CERT_IN_CHAIN), which would
// otherwise make every query fail. The connection is still encrypted via
// TLS — only certificate chain verification is relaxed. In development,
// SSL is left off entirely for local Postgres compatibility.
const ssl =
  process.env["NODE_ENV"] === "production"
    ? { rejectUnauthorized: false }
    : false;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  // Never let an unreachable external Postgres endpoint hold every request
  // open indefinitely. This is especially important for Render + Supabase
  // when a direct IPv6-only database endpoint is used instead of the pooler.
  connectionTimeoutMillis: 8_000,
  query_timeout: 15_000,
  idleTimeoutMillis: 30_000,
  max: 10,
  keepAlive: true,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
