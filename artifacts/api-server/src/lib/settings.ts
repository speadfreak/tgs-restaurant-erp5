import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const MASTER_KEY =
  process.env.SETTINGS_ENCRYPTION_KEY ??
  process.env.JWT_SECRET ??
  process.env.SESSION_SECRET ??
  "tg-erp-settings-key-fallback";

const SALT = "tg-erp-settings-salt-v1";

function deriveKey(): Buffer {
  return crypto.scryptSync(MASTER_KEY, SALT, 32);
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(ciphertext: string): string {
  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx === -1) return ciphertext;
  try {
    const iv = Buffer.from(ciphertext.slice(0, colonIdx), "hex");
    const encBuf = Buffer.from(ciphertext.slice(colonIdx + 1), "hex");
    const key = deriveKey();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString("utf8");
  } catch {
    return ciphertext;
  }
}

export function maskValue(value: string): string {
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••••••" + value.slice(-4);
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
    if (row) {
      if (row.isSensitive) return decrypt(row.value);
      return row.value || null;
    }
  } catch {
    /* DB not ready — fall through to env */
  }
  const envKey = key.toUpperCase().replace(/-/g, "_");
  return process.env[envKey] ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  isSensitive = false,
  updatedByUserId?: number,
): Promise<void> {
  const stored = isSensitive ? encrypt(value) : value;
  await db
    .insert(settingsTable)
    .values({ key, value: stored, isSensitive, updatedByUserId: updatedByUserId ?? null })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: stored, isSensitive, updatedByUserId: updatedByUserId ?? null, updatedAt: new Date() },
    });
}

export async function getAllSettings(): Promise<
  Array<{ key: string; masked: string | null; isSensitive: boolean; updatedAt: string }>
> {
  const rows = await db.select().from(settingsTable);
  return rows.map((r) => ({
    key: r.key,
    masked: r.isSensitive ? maskValue(decrypt(r.value)) : r.value,
    isSensitive: r.isSensitive,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
