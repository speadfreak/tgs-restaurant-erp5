import { randomBytes } from "crypto";
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";
import {
  db,
  customersTable,
  customerStreaksTable,
  streakActiveDaysTable,
  streakPrizesTable,
  type CustomerStreak,
  type StreakPrize,
} from "@workspace/db";
import { getSetting } from "./settings";
import { sendWhatsAppMessage } from "./twilio";

const UAE_TIMEZONE = "Asia/Dubai";
const DAY_MS = 86_400_000;
const DEFAULT_CYCLE_LENGTH = 7;
const DEFAULT_MIN_ORDERS = 6;

export type StreakMessage = { en: string; am: string };

export type StreakResult = {
  streakCode: string;
  activeDays: number;
  ordersCompleted: number;
  winningProgress: number;
  cycleLength: number;
  minOrders: number;
  minDays: number;
  daysLeft: number;
  ordersRemaining: number;
  daysNeeded: number;
  isWinner: boolean;
  prize: StreakPrize | null;
  message: StreakMessage;
  status: string;
  cycleStartDate: string;
  cycleEndDate: string;
  cycleStartAt: string;
  cycleEndAt: string;
};

export type StreakSnapshot = Omit<StreakResult, "message"> & {
  message: StreakMessage | null;
  customerName: string | null;
  customerPhone: string;
};

type StreakProgress = {
  orderCount: number;
  activeDates: string[];
};

function dateInUAE(value: Date): string {
  return value.toLocaleDateString("en-CA", { timeZone: UAE_TIMEZONE });
}

function dayNumber(value: string): number {
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  ) / 86_400_000;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

function uaeMidnight(value: string): Date {
  return new Date(`${value}T00:00:00+04:00`);
}

function uaeMidnightAfter(value: string): Date {
  const utcDate = new Date(`${value}T00:00:00Z`);
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return uaeMidnight(utcDate.toISOString().slice(0, 10));
}

export function getStreakCycleTimes(streak: CustomerStreak): {
  cycleStartAt: Date;
  cycleEndAt: Date;
  cycleLengthDays: number;
} {
  if (streak.cycleStartAt && streak.cycleEndAt) {
    const cycleLengthDays = Math.max(
      1,
      Math.round((streak.cycleEndAt.getTime() - streak.cycleStartAt.getTime()) / DAY_MS),
    );
    return {
      cycleStartAt: streak.cycleStartAt,
      cycleEndAt: streak.cycleEndAt,
      cycleLengthDays,
    };
  }

  // Existing challenges predate saved timestamps. Use their creation instant
  // when it falls on the recorded first day, otherwise preserve the old UAE
  // calendar-day boundary as the safest available legacy fallback.
  const createdAt = new Date(streak.createdAt);
  const cycleStartAt = dateInUAE(createdAt) === streak.cycleStartDate
    ? createdAt
    : uaeMidnight(streak.cycleStartDate);
  const cycleLengthDays = Math.max(1, daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1);
  return {
    cycleStartAt,
    cycleEndAt: uaeMidnightAfter(streak.cycleEndDate),
    cycleLengthDays,
  };
}

function normalizePhone(phone: string): string {
  const value = phone.replace(/^whatsapp:/i, "");
  if (/\p{L}/u.test(value)) return "";
  return value.replace(/[^\d+]/g, "");
}

function isHumanCustomerName(value: string | null | undefined): boolean {
  const name = value?.trim() ?? "";
  return Boolean(name && /\p{L}/u.test(name) && !/^customer(?:\s*#.*)?$/i.test(name));
}

function nameIdentity(value: string | null | undefined): string {
  const name = value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en") ?? "";
  return isHumanCustomerName(name) ? `name:${name}` : "";
}

export function resolveCustomerStreakIdentity(
  phoneOrName: string | null | undefined,
  customerName: string | null | undefined,
): string {
  const raw = phoneOrName?.trim().replace(/^whatsapp:/i, "") ?? "";
  if (raw.startsWith("name:")) return nameIdentity(raw.slice("name:".length));
  if (raw) {
    const phone = normalizePhone(raw);
    if (phone) return phone;
    return nameIdentity(isHumanCustomerName(customerName) ? customerName : raw);
  }
  const name = customerName?.trim() ?? "";
  return normalizePhone(name) || nameIdentity(name);
}

export function displayCustomerStreakIdentity(identity: string, customerName: string | null): string {
  return identity.startsWith("name:")
    ? customerName?.trim() || identity.slice("name:".length)
    : identity;
}

function isPhoneIdentity(identity: string): boolean {
  return !identity.startsWith("name:") && /^\+?\d+$/.test(identity);
}

function createStreakCode(): string {
  return `STK-${randomBytes(4).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6).padEnd(6, "0")}`;
}

async function createUniqueStreakCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = createStreakCode();
    const [existingStreaks, existingCustomers] = await Promise.all([
      db.select({ id: customerStreaksTable.id })
        .from(customerStreaksTable)
        .where(eq(customerStreaksTable.streakCode, code))
        .limit(1),
      db.select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.streakCode, code))
        .limit(1),
    ]);
    if (!existingStreaks[0] && !existingCustomers[0]) return code;
  }
  throw new Error("Could not allocate a unique streak challenge code");
}

function prizeOrderTarget(prize: StreakPrize | null): number {
  return prize?.minOrdersRequired ?? prize?.minDaysRequired ?? DEFAULT_MIN_ORDERS;
}

function streakOrderTarget(streak: CustomerStreak, prize: StreakPrize | null): number {
  return streak.targetOrders || prizeOrderTarget(prize);
}

export async function getActivePrize(branchId: number): Promise<StreakPrize | null> {
  const rows = await db.select().from(streakPrizesTable).where(
    and(
      eq(streakPrizesTable.isActive, true),
      isNull(streakPrizesTable.archivedAt),
      or(eq(streakPrizesTable.branchId, branchId), isNull(streakPrizesTable.branchId)),
    ),
  ).orderBy(desc(streakPrizesTable.id));
  return rows.find(prize => prize.branchId === branchId) ?? rows.find(prize => prize.branchId === null) ?? null;
}

async function ensureCustomerCode(phone: string, name: string): Promise<string> {
  const isName = phone.startsWith("name:");
  const [customer] = isName
    ? [undefined]
    : await db.select().from(customersTable).where(eq(customersTable.phone, phone));
  // Challenge codes are unique per cycle. Reusing a completed/lost row's code
  // makes the next cycle fail its unique constraint and leaves stale progress.
  const code = await createUniqueStreakCode();
  if (customer) {
    await db.update(customersTable).set({ streakCode: code }).where(eq(customersTable.id, customer.id));
  } else if (!isName) {
    try {
      await db.insert(customersTable).values({ name: name || "Customer", phone, streakCode: code });
    } catch {
      // Delivery orders may intentionally use a direct customer identity.
    }
  }
  return code;
}

export async function getActiveStreak(phone: string): Promise<CustomerStreak | null> {
  const [streak] = await db.select().from(customerStreaksTable)
    .where(and(eq(customerStreaksTable.customerPhone, phone), eq(customerStreaksTable.status, "active")))
    .orderBy(desc(customerStreaksTable.updatedAt), desc(customerStreaksTable.id))
    .limit(1);
  return streak ?? null;
}

async function createNewStreak(
  phone: string,
  name: string,
  branchId: number,
  code?: string,
  startAt = new Date(),
): Promise<CustomerStreak> {
  const prize = await getActivePrize(branchId);
  const targetOrders = prizeOrderTarget(prize);
  const cycleLength = prize?.cycleLengthDays ?? (Number(await getSetting("streak_default_cycle_length")) || DEFAULT_CYCLE_LENGTH);
  const cycleStartAt = startAt;
  const cycleEndAt = new Date(cycleStartAt.getTime() + cycleLength * DAY_MS);
  const customerName = name.trim() || "Customer";
  const [streak] = await db.insert(customerStreaksTable).values({
    customerPhone: phone,
    customerName,
    streakCode: code ?? await ensureCustomerCode(phone, customerName),
    branchId,
    cycleStartDate: dateInUAE(cycleStartAt),
    cycleEndDate: dateInUAE(cycleEndAt),
    cycleStartAt,
    cycleEndAt,
    activeDays: 0,
    orderCount: 0,
    targetOrders,
    activeDayDates: [],
    streakMode: "window",
    status: "active",
    prizeId: prize?.id ?? null,
  }).returning();
  if (!streak) throw new Error("Could not create customer challenge");
  const [customer] = phone.startsWith("name:")
    ? [undefined]
    : await db.select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.phone, phone));
  if (customer) {
    await db.update(customersTable)
      .set({ currentStreakId: streak.id, streakCode: streak.streakCode })
      .where(eq(customersTable.id, customer.id));
  }
  return streak;
}

async function getPrizeForStreak(streak: CustomerStreak): Promise<StreakPrize | null> {
  if (streak.prizeId) {
    const [prize] = await db.select().from(streakPrizesTable).where(eq(streakPrizesTable.id, streak.prizeId));
    return prize ?? null;
  }
  return getActivePrize(streak.branchId ?? 0);
}

async function getStreakProgress(streak: CustomerStreak): Promise<StreakProgress> {
  const rows = await db.select({
    activeDate: streakActiveDaysTable.activeDate,
  }).from(streakActiveDaysTable)
    .where(eq(streakActiveDaysTable.streakId, streak.id))
    .orderBy(asc(streakActiveDaysTable.activeDate), asc(streakActiveDaysTable.id));

  // Rows are now one per delivered order. The fallback keeps older day-based
  // records visible until their first order is added after this upgrade.
  const orderCount = Math.max(
    rows.length,
    streak.orderCount ?? 0,
    streak.activeDays ?? 0,
    streak.activeDayDates.length,
  );
  const activeDates = Array.from(new Set(rows.map(row => row.activeDate).concat(streak.activeDayDates ?? []))).sort();
  return { orderCount, activeDates };
}

async function syncStreakProgress(streak: CustomerStreak, progress: StreakProgress): Promise<void> {
  await db.update(customerStreaksTable).set({
    activeDays: progress.activeDates.length,
    orderCount: progress.orderCount,
    activeDayDates: progress.activeDates,
    updatedAt: new Date(),
  }).where(eq(customerStreaksTable.id, streak.id));
}

function displayPrizeName(prize: StreakPrize | null): string {
  if (prize?.discountPercent) return `${prize.discountPercent}% Off`;
  return prize?.name || "your foodie reward";
}

function formatChallengeDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: UAE_TIMEZONE,
    timeZoneName: "short",
  }).format(value);
}

function generateStreakMessage(params: {
  ordersCompleted: number;
  minOrders: number;
  daysLeft: number;
  ordersRemaining: number;
  isWinner: boolean;
  prize: StreakPrize | null;
  streakCode: string;
  cycleEnded: boolean;
  cycleStartAt: Date;
  cycleEndAt: Date;
}): StreakMessage {
  const { ordersCompleted, minOrders, daysLeft, ordersRemaining, isWinner, prize, streakCode, cycleEnded, cycleStartAt, cycleEndAt } = params;
  const prizeName = displayPrizeName(prize);
  const startTime = formatChallengeDateTime(cycleStartAt);
  const endTime = formatChallengeDateTime(cycleEndAt);
  const amWindow = `🕘 የፈተናው ጊዜ: ${startTime} – ${endTime} (የዱባይ ሰዓት)`;
  const enWindow = `🕘 Challenge window: ${startTime} – ${endTime} (Dubai time)`;

  if (isWinner && prize) {
    return {
      en: `🎉 FOODIE CHALLENGE COMPLETE!\nYou completed ${ordersCompleted}/${minOrders} orders and won ${prizeName}! Please claim your prize on your next visit.\n\n🎫 Challenge code: ${streakCode}\n${enWindow}`,
      am: `🎉 የትዕዛዝ ፈተናው ተጠናቀቀ!\nበዚህ ዙር ${ordersCompleted}/${minOrders} የትዕዛዝ ጊዜ አጠናቀው ${prizeName} አሸንፈዋል! ሽልማትዎን ለመውሰድ በሚቀጥለው ጉብኝትዎ ይምጡ።\n\n🎫 የፈተና ኮድ: ${streakCode}\n${amWindow}`,
    };
  }

  if (cycleEnded) {
    return {
      en: `This round ended at ${ordersCompleted}/${minOrders} orders. Your next foodie challenge starts with your next delicious order — see you soon!\n\n🎫 Challenge code: ${streakCode}\n${enWindow}`,
      am: `ይህ ዙር ${ordersCompleted}/${minOrders} የትዕዛዝ ጊዜ ላይ አብቅቷል። በሚቀጥለው ትዕዛዝዎ አዲስ የትዕዛዝ ፈተና ይጀምራል — በቅርቡ እንገናኝ!\n\n🎫 የፈተና ኮድ: ${streakCode}\n${amWindow}`,
    };
  }

  if (ordersRemaining > 0) {
    const orderWord = ordersRemaining === 1 ? "order" : "orders";
    const orderWordAm = ordersRemaining === 1 ? "የትዕዛዝ ጊዜ" : "የትዕዛዝ ጊዜዎች";
    return {
      en: `Just ${ordersRemaining} more ${orderWord} of delicious meals to score ${prizeName}! You've completed ${ordersCompleted}/${minOrders} orders this cycle. See you next order!${daysLeft === 0 ? " Today is the final day." : ""}\n\n🎫 Challenge code: ${streakCode}\n${enWindow}`,
      am: `${ordersRemaining} ${orderWordAm} ብቻ ${prizeName} ለማግኘት ቀርተዋል! በዚህ ዙር ${ordersCompleted}/${minOrders} አጠናቀዋል። በቀጣይ ትዕዛዝ እንገናኝ!${daysLeft === 0 ? " ዛሬ የመጨረሻ ቀን ነው።" : ""}\n\n🎫 የፈተና ኮድ: ${streakCode}\n${amWindow}`,
    };
  }

  return {
    en: `You're on a delicious roll! You've completed ${ordersCompleted}/${minOrders} orders this cycle. Keep the good food coming!\n\n🎫 Challenge code: ${streakCode}\n${enWindow}`,
    am: `በጣፋጭ ጉዞ ላይ ነዎት! በዚህ ዙር ${ordersCompleted}/${minOrders} አጠናቀዋል። ጣፋጭ ትዕዛዝዎን ይቀጥሉ!\n\n🎫 የፈተና ኮድ: ${streakCode}\n${amWindow}`,
  };
}

async function notifyWinner(streak: CustomerStreak, prize: StreakPrize | null, progress: StreakProgress): Promise<void> {
  if (!isPhoneIdentity(streak.customerPhone) || (await getSetting("streak_auto_notification")) === "false" || !prize) return;
  const target = streakOrderTarget(streak, prize);
  const cycleTimes = getStreakCycleTimes(streak);
  const message = generateStreakMessage({
    ordersCompleted: progress.orderCount,
    minOrders: target,
    daysLeft: 0,
    ordersRemaining: 0,
    isWinner: true,
    prize,
    streakCode: streak.streakCode,
    cycleEnded: true,
    cycleStartAt: cycleTimes.cycleStartAt,
    cycleEndAt: cycleTimes.cycleEndAt,
  });
  const result = await sendWhatsAppMessage(streak.customerPhone, `${message.am}\n\n${message.en}`);
  if (result.ok) {
    await db.update(customerStreaksTable).set({ notifiedAt: new Date() }).where(eq(customerStreaksTable.id, streak.id));
  }
}

async function finalizeExpiredStreak(streak: CustomerStreak, sendNotifications = true): Promise<void> {
  const prize = await getPrizeForStreak(streak);
  const progress = await getStreakProgress(streak);
  const target = streakOrderTarget(streak, prize);
  const cycleTimes = getStreakCycleTimes(streak);
  await syncStreakProgress(streak, progress);

  if (progress.orderCount >= target) {
    const [won] = await db.update(customerStreaksTable)
      .set({ status: "won", wonAt: new Date() })
      .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")))
      .returning();
    if (won && sendNotifications) await notifyWinner({ ...streak, ...won }, prize, progress);
    return;
  }

  await db.update(customerStreaksTable)
    .set({ status: "lost" })
    .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")));

  if (sendNotifications && isPhoneIdentity(streak.customerPhone) && (await getSetting("streak_reset_notification")) === "true") {
    const resetMessage = generateStreakMessage({
      ordersCompleted: progress.orderCount,
      minOrders: target,
      daysLeft: 0,
      ordersRemaining: Math.max(0, target - progress.orderCount),
      isWinner: false,
      prize,
      streakCode: streak.streakCode,
      cycleEnded: true,
      cycleStartAt: cycleTimes.cycleStartAt,
      cycleEndAt: cycleTimes.cycleEndAt,
    });
    await sendWhatsAppMessage(streak.customerPhone, `${resetMessage.am}\n\n${resetMessage.en}`);
  }
  // Do not create the next cycle here. The next delivered order is what starts
  // the next customer's challenge window.
}

export async function processDeliveryStreak(
  orderId: number,
  customerPhone: string,
  customerName: string,
  branchId: number,
  options: { deliveredAt?: Date; suppressNotifications?: boolean } = {},
): Promise<StreakResult | null> {
  if ((await getSetting("streak_enabled")) === "false") return null;
  const phone = resolveCustomerStreakIdentity(customerPhone, customerName);
  if (!phone) return null;
  const displayName = phone.startsWith("name:")
    ? isHumanCustomerName(customerName) ? customerName.trim() : phone.slice("name:".length)
    : customerName.trim() || "Customer";
  const deliveredAt = options.deliveredAt ?? new Date();
  let streak = await getActiveStreak(phone);

  if (streak && deliveredAt.getTime() >= getStreakCycleTimes(streak).cycleEndAt.getTime()) {
    await finalizeExpiredStreak(streak, !options.suppressNotifications);
    streak = await getActiveStreak(phone);
  }
  if (streak && deliveredAt.getTime() < getStreakCycleTimes(streak).cycleStartAt.getTime()) return null;
  if (!streak) {
    const code = await ensureCustomerCode(phone, displayName);
    streak = await createNewStreak(phone, displayName, branchId, code, deliveredAt);
  }
  if (isHumanCustomerName(displayName) && !isHumanCustomerName(streak.customerName)) {
    await db.update(customerStreaksTable)
      .set({ customerName: displayName, updatedAt: new Date() })
      .where(eq(customerStreaksTable.id, streak.id));
    streak = { ...streak, customerName: displayName };
  }

  const [insertedOrder] = await db.insert(streakActiveDaysTable).values({
    streakId: streak.id,
    activeDate: dateInUAE(deliveredAt),
    orderId,
  }).onConflictDoNothing().returning({ id: streakActiveDaysTable.id });

  const progress = await getStreakProgress(streak);
  if (insertedOrder) {
    const previousCount = Math.max(
      streak.orderCount ?? 0,
      streak.activeDays ?? 0,
      streak.activeDayDates.length,
    );
    progress.orderCount = Math.max(progress.orderCount, previousCount + 1);
  }
  const prize = await getPrizeForStreak(streak);
  const cycleTimes = getStreakCycleTimes(streak);
  const cycleLength = cycleTimes.cycleLengthDays;
  const minOrders = streakOrderTarget(streak, prize);
  const cycleEnded = deliveredAt.getTime() >= cycleTimes.cycleEndAt.getTime();
  const isWinner = !cycleEnded && progress.orderCount >= minOrders;
  const daysLeft = Math.max(0, Math.ceil((cycleTimes.cycleEndAt.getTime() - deliveredAt.getTime()) / DAY_MS));
  const ordersRemaining = Math.max(0, minOrders - progress.orderCount);

  if (isWinner) {
    const [won] = await db.update(customerStreaksTable)
      .set({
        activeDays: progress.activeDates.length,
        orderCount: progress.orderCount,
        activeDayDates: progress.activeDates,
        status: "won",
        wonAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")))
      .returning();
    if (won && !options.suppressNotifications) await notifyWinner({ ...streak, ...won }, prize, progress);
  } else {
    await syncStreakProgress(streak, progress);
  }

  return {
    streakCode: streak.streakCode,
    activeDays: progress.activeDates.length,
    ordersCompleted: progress.orderCount,
    winningProgress: progress.orderCount,
    cycleLength,
    minOrders,
    minDays: minOrders,
    daysLeft,
    ordersRemaining,
    daysNeeded: ordersRemaining,
    isWinner,
    prize,
    status: isWinner ? "won" : "active",
    cycleStartDate: streak.cycleStartDate,
    cycleEndDate: streak.cycleEndDate,
    cycleStartAt: cycleTimes.cycleStartAt.toISOString(),
    cycleEndAt: cycleTimes.cycleEndAt.toISOString(),
    message: generateStreakMessage({
      ordersCompleted: progress.orderCount,
      minOrders,
      daysLeft,
      ordersRemaining,
      isWinner,
      prize,
      streakCode: streak.streakCode,
      cycleEnded,
      cycleStartAt: cycleTimes.cycleStartAt,
      cycleEndAt: cycleTimes.cycleEndAt,
    }),
  };
}

export async function getStreakSnapshot(phone: string): Promise<StreakSnapshot | null> {
  const normalized = resolveCustomerStreakIdentity(phone, null);
  if (!normalized) return null;
  let rows = await db.select().from(customerStreaksTable)
    .where(eq(customerStreaksTable.customerPhone, normalized))
    .orderBy(desc(customerStreaksTable.updatedAt), desc(customerStreaksTable.id))
    .limit(5);
  let streak = rows.find(row => row.status === "active") ?? rows[0];
  if (!streak) return null;

  if (streak.status === "active" && Date.now() >= getStreakCycleTimes(streak).cycleEndAt.getTime()) {
    await finalizeExpiredStreak(streak);
    rows = await db.select().from(customerStreaksTable)
      .where(eq(customerStreaksTable.customerPhone, normalized))
      .orderBy(desc(customerStreaksTable.updatedAt), desc(customerStreaksTable.id))
      .limit(5);
    streak = rows.find(row => row.status === "active") ?? rows[0];
    if (!streak) return null;
  }

  const prize = await getPrizeForStreak(streak);
  const progress = await getStreakProgress(streak);
  const minOrders = streakOrderTarget(streak, prize);
  const cycleTimes = getStreakCycleTimes(streak);
  const daysLeft = streak.status === "active"
    ? Math.max(0, Math.ceil((cycleTimes.cycleEndAt.getTime() - Date.now()) / DAY_MS))
    : 0;
  const ordersRemaining = Math.max(0, minOrders - progress.orderCount);
  return {
    streakCode: streak.streakCode,
    activeDays: progress.activeDates.length,
    ordersCompleted: progress.orderCount,
    winningProgress: progress.orderCount,
    cycleLength: cycleTimes.cycleLengthDays,
    minOrders,
    minDays: minOrders,
    daysLeft,
    ordersRemaining,
    daysNeeded: ordersRemaining,
    isWinner: streak.status === "won",
    prize,
    status: streak.status,
    cycleStartDate: streak.cycleStartDate,
    cycleEndDate: streak.cycleEndDate,
    cycleStartAt: cycleTimes.cycleStartAt.toISOString(),
    cycleEndAt: cycleTimes.cycleEndAt.toISOString(),
    message: generateStreakMessage({
      ordersCompleted: progress.orderCount,
      minOrders,
      daysLeft,
      ordersRemaining,
      isWinner: streak.status === "won",
      prize,
      streakCode: streak.streakCode,
      cycleEnded: streak.status !== "active",
      cycleStartAt: cycleTimes.cycleStartAt,
      cycleEndAt: cycleTimes.cycleEndAt,
    }),
    customerName: streak.customerName,
    customerPhone: displayCustomerStreakIdentity(streak.customerPhone, streak.customerName),
  };
}

export async function processEndingStreaks(): Promise<number> {
  const now = new Date();
  const candidates = await db.select().from(customerStreaksTable).where(
    and(
      eq(customerStreaksTable.status, "active"),
      or(isNull(customerStreaksTable.cycleEndAt), lte(customerStreaksTable.cycleEndAt, now)),
    ),
  );
  const ending = candidates.filter(streak => getStreakCycleTimes(streak).cycleEndAt.getTime() <= now.getTime());
  for (const streak of ending) await finalizeExpiredStreak(streak);
  return ending.length;
}