const UAE_TIME_ZONE = "Asia/Dubai";

export function formatStreakDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: UAE_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

export function formatStreakCountdown(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const expiry = new Date(value).getTime();
  if (!Number.isFinite(expiry)) return "—";

  const totalSeconds = Math.max(0, Math.ceil((expiry - now) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}