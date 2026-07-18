/**
 * UAE (Asia/Dubai) timezone helpers.
 * All server timestamps are stored in UTC. The restaurant operates in UAE (UTC+4, no DST).
 * Use these helpers everywhere dates or times are displayed or compared.
 */
const UAE = "Asia/Dubai";

/**
 * Format a UTC timestamp as "MMM D, HH:mm" in UAE time.
 * e.g. "Jul 17, 06:14"
 */
export function fmtUAE(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: UAE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  // Intl hour12:false sometimes returns "24" for midnight — normalise
  const hr = get("hour") === "24" ? "00" : get("hour");
  return `${get("month")} ${get("day")}, ${hr}:${get("minute")}`;
}

/**
 * Today's date as "YYYY-MM-DD" in UAE timezone.
 */
export function todayUAE(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: UAE });
}

/**
 * Returns true if the given timestamp falls on today in UAE timezone.
 * Use this instead of comparing toDateString() values, which use browser-local time.
 */
export function isTodayUAE(iso: string | Date | null | undefined): boolean {
  if (!iso) return false;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-CA", { timeZone: UAE }) === todayUAE();
}
