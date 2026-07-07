import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Enable SSL in production so the connection to Neon (and any other hosted
// Postgres) is encrypted. Neon uses certificates from a trusted CA so
// full verification (rejectUnauthorized: true, which is the default for
// ssl: true) is safe here.  In development, SSL is left off for local
// Postgres compatibility.
const ssl = process.env["NODE_ENV"] === "production" ? true : false;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
export const db = drizzle(pool, { schema });

export * from "./schema";
