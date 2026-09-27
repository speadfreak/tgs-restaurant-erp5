import { randomBytes } from "crypto";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
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
const DEFAULT_CYCLE_LENGTH = 7;
const DEFAULT_MIN_DAYS = 4;

export type StreakMessage = { en: string; am: string };

export type StreakResult = {
  streakCode: string;
  activeDays: number;
  winningProgress: number;
  cycleLength: number;
  minDays: number;
  daysLeft: number;
  daysNeeded: number;
  isWinner: boolean;
  prize: StreakPrize | null;
  message: StreakMessage;
  status: string;
  cycleStartDate: string;
  cycleEndDate: string;
};

export type StreakSnapshot = Omit<StreakResult, "message"> & {
  message: StreakMessage | null;
  customerName: string | null;
  customerPhone: string;
};

function todayUAE(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: UAE_TIMEZONE });
}

function dayNumber(value: string): number {
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  ) / 86_400_000;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

function normalizePhone(phone: string): string {
  return phone.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
}

function createStreakCode(): string {
  return `STK-${randomBytes(4).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6).padEnd(6, "0")}`;
}

export async function getActivePrize(branchId: number): Promise<StreakPrize | null> {
  const rows = await db.select().from(streakPrizesTable).where(
    and(
      eq(streakPrizesTable.isActive, true),
      or(eq(streakPrizesTable.branchId, branchId), isNull(streakPrizesTable.branchId)),
    ),
  ).orderBy(desc(streakPrizesTable.id));
  return rows.find(prize => prize.branchId === branchId) ?? rows.find(prize => prize.branchId === null) ?? null;
}

async function ensureCustomerCode(phone: string, name: string): Promise<string> {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.phone, phone));
  if (customer?.streakCode) return customer.streakCode;

  let code = createStreakCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await db.select({ id: customerStreaksTable.id })
      .from(customerStreaksTable)
      .where(eq(customerStreaksTable.streakCode, code));
    if (!existing) break;
    code = createStreakCode();
  }
  if (customer) {
    await db.update(customersTable).set({ streakCode: code }).where(eq(customersTable.id, customer.id));
  } else {
    try {
      await db.insert(customersTable).values({ name: name || "Customer", phone, streakCode: code });
    } catch {
      // Delivery orders may intentionally use a direct customer identity. The
      // streak remains valid even when the legacy customer record is absent.
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

async function createNewStreak(phone: string, name: string, branchId: number, code?: string): Promise<CustomerStreak> {
  const prize = await getActivePrize(branchId);
  const cycleLength = prize?.cycleLengthDays ?? (Number(await getSetting("streak_default_cycle_length")) || DEFAULT_CYCLE_LENGTH);
  const minDays = prize?.minDaysRequired ?? (Number(await getSetting("streak_default_min_days")) || DEFAULT_MIN_DAYS);
  const mode = prize?.streakMode ?? "window";
  const start = todayUAE();
  const [streak] = await db.insert(customerStreaksTable).values({
    customerPhone: phone,
    customerName: name || "Customer",
    streakCode: code ?? await ensureCustomerCode(phone, name),
    branchId,
    cycleStartDate: start,
    cycleEndDate: addDays(start, cycleLength - 1),
    activeDays: 0,
    activeDayDates: [],
    streakMode: mode,
    status: "active",
    prizeId: prize?.id ?? null,
  }).returning();
  if (!streak) throw new Error("Could not create customer streak");
  const [customer] = await db.select({ id: customersTable.id })
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

async function getActiveDates(streakId: number): Promise<string[]> {
  const rows = await db.select({ activeDate: streakActiveDaysTable.activeDate })
    .from(streakActiveDaysTable)
    .where(eq(streakActiveDaysTable.streakId, streakId))
    .orderBy(asc(streakActiveDaysTable.activeDate));
  return rows.map(row => row.activeDate);
}

function longestConsecutiveRun(dates: string[]): number {
  let longest = 0;
  let current = 0;
  for (let index = 0; index < dates.length; index++) {
    current = index > 0 && dayNumber(dates[index]!) === dayNumber(dates[index - 1]!) + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function generateStreakMessage(params: {
  activeDays: number;
  winningProgress: number;
  cycleLength: number;
  minDays: number;
  daysLeft: number;
  daysNeeded: number;
  canStillWin: boolean;
  isWinner: boolean;
  prize: StreakPrize | null;
  streakCode: string;
  customerName: string;
  cycleEnded: boolean;
}): StreakMessage {
  const {
    activeDays, winningProgress, cycleLength, minDays, daysLeft, daysNeeded,
    canStillWin, isWinner, prize, streakCode, customerName, cycleEnded,
  } = params;
  const prizeName = prize?.name || "your prize";
  if (isWinner && prize) {
    return {
      en: `CONGRATULATIONS ${customerName}! You ordered ${activeDays} days this cycle and WON: ${prize.name}. Your streak code: ${streakCode}. Contact us to claim your prize. Thank you for being a loyal TG's customer!`,
      am: `እንኳን ደስ አለዎ ${customerName}! በዚህ ዑደት ${activeDays} ቀን ትዕዛዝ ሰጥተዋል እና ${prize.name} አሸነፉ። የስትሪክ ኮድዎ: ${streakCode}። ሽልማቱን ለማግኘት ያግኙን።`,
    };
  }
  if (cycleEnded) {
    return {
      en: `This cycle ended at ${activeDays}/${minDays} active days. Your new streak starts now — order again tomorrow and begin your journey to ${prizeName}. Streak code: ${streakCode}`,
      am: `ይህ ዑደት ${activeDays}/${minDays} ንቁ ቀናት ላይ አብቅቷል። አዲሱ ስትሪክዎ አሁን ይጀምራል፤ ነገ እንደገና ይዘዙ። ስትሪክ ኮድ: ${streakCode}`,
    };
  }
  if (daysNeeded === 0) {
    return {
      en: `Amazing ${customerName}! You have ${winningProgress} winning days — you are on track to win ${prizeName}. ${daysLeft} day(s) left. Keep going! Streak: ${streakCode}`,
      am: `አስደናቂ ${customerName}! ${winningProgress} የማሸነፊያ ቀናት ደርሰዋል፤ ${prizeName} ለማሸነፍ በጥሩ ሁኔታ ላይ ነዎት። ${daysLeft} ቀን ቀርቷል። ስትሪክ: ${streakCode}`,
    };
  }
  if (!canStillWin) {
    return {
      en: `Streak ${streakCode}: ${winningProgress}/${minDays} days. There is not enough time left this cycle, but your next cycle starts fresh. Keep ordering with us!`,
      am: `ስትሪክ ${streakCode}: ${winningProgress}/${minDays} ቀናት። በዚህ ዑደት በቂ ጊዜ አልቀረም፤ ቀጣዩ ዑደት አዲስ ይጀምራል። ከእኛ ጋር መዘዙን ይቀጥሉ!`,
    };
  }
  return {
    en: `${daysNeeded === 1 ? "ONE MORE DAY" : `${daysNeeded} more days`} to win ${prizeName}. You have ${winningProgress}/${minDays} winning days this cycle and ${daysLeft} day(s) left. Order tomorrow too! Streak: ${streakCode}`,
    am: `${daysNeeded === 1 ? "አንድ ቀን ብቻ ቀረ" : `${daysNeeded} ተጨማሪ ቀናት`} ${prizeName} ለማሸነፍ። በዚህ ዑደት ${winningProgress}/${minDays} ቀናት አሉዎት፤ ${daysLeft} ቀን ቀርቷል። ነገም ይዘዙ! ስትሪክ: ${streakCode}`,
  };
}

async function notifyWinner(streak: CustomerStreak, prize: StreakPrize | null): Promise<void> {
  if ((await getSetting("streak_auto_notification")) === "false" || !prize) return;
  const message = generateStreakMessage({
    activeDays: streak.activeDays,
    winningProgress: streak.activeDays,
    cycleLength: daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1,
    minDays: prize.minDaysRequired,
    daysLeft: 0,
    daysNeeded: 0,
    canStillWin: false,
    isWinner: true,
    prize,
    streakCode: streak.streakCode,
    customerName: streak.customerName ?? "Customer",
    cycleEnded: true,
  });
  const result = await sendWhatsAppMessage(streak.customerPhone, `${message.am}\n\n${message.en}`);
  if (result.ok) {
    await db.update(customerStreaksTable).set({ notifiedAt: new Date() }).where(eq(customerStreaksTable.id, streak.id));
  }
}

async function finalizeExpiredStreak(streak: CustomerStreak): Promise<void> {
  const prize = await getPrizeForStreak(streak);
  const dates = await getActiveDates(streak.id);
  const winningProgress = streak.streakMode === "consecutive" ? longestConsecutiveRun(dates) : dates.length;
  if (winningProgress >= (prize?.minDaysRequired ?? DEFAULT_MIN_DAYS)) {
    const [won] = await db.update(customerStreaksTable)
      .set({ status: "won", activeDays: dates.length, activeDayDates: dates, wonAt: new Date() })
      .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")))
      .returning();
    if (won) await notifyWinner({ ...streak, ...won }, prize);
  } else {
    await db.update(customerStreaksTable)
      .set({ status: "lost", activeDays: dates.length, activeDayDates: dates })
      .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")));
    if ((await getSetting("streak_reset_notification")) === "true") {
      const resetMessage = generateStreakMessage({
        activeDays: dates.length,
        winningProgress,
        cycleLength: prize?.cycleLengthDays ?? DEFAULT_CYCLE_LENGTH,
        minDays: prize?.minDaysRequired ?? DEFAULT_MIN_DAYS,
        daysLeft: 0,
        daysNeeded: Math.max(0, (prize?.minDaysRequired ?? DEFAULT_MIN_DAYS) - winningProgress),
        canStillWin: false,
        isWinner: false,
        prize,
        streakCode: streak.streakCode,
        customerName: streak.customerName ?? "Customer",
        cycleEnded: true,
      });
      await sendWhatsAppMessage(streak.customerPhone, `${resetMessage.am}\n\n${resetMessage.en}`);
    }
    // Keep the completed cycle in history and make a fresh active cycle
    // available immediately, as required by the reset rule.
    await createNewStreak(streak.customerPhone, streak.customerName ?? "Customer", streak.branchId ?? 0, streak.streakCode);
  }
}

export async function processDeliveryStreak(
  orderId: number,
  customerPhone: string,
  customerName: string,
  branchId: number,
): Promise<StreakResult | null> {
  if ((await getSetting("streak_enabled")) === "false") return null;
  const phone = normalizePhone(customerPhone);
  if (!phone) return null;
  const today = todayUAE();
  let streak = await getActiveStreak(phone);
  if (streak && dayNumber(today) > dayNumber(streak.cycleEndDate)) {
    await finalizeExpiredStreak(streak);
    // A loss creates the next active cycle immediately; a win waits for the
    // next order so the winner remains the public snapshot until then.
    streak = await getActiveStreak(phone);
  }
  if (!streak) {
    const code = await ensureCustomerCode(phone, customerName);
    streak = await createNewStreak(phone, customerName, branchId, code);
  }

  await db.insert(streakActiveDaysTable).values({
    streakId: streak.id,
    activeDate: today,
    orderId,
  }).onConflictDoNothing();
  const activeDates = await getActiveDates(streak.id);
  const prize = await getPrizeForStreak(streak);
  const cycleLength = prize?.cycleLengthDays ?? daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1;
  const minDays = prize?.minDaysRequired ?? DEFAULT_MIN_DAYS;
  const winningProgress = streak.streakMode === "consecutive" ? longestConsecutiveRun(activeDates) : activeDates.length;
  const cycleEnded = dayNumber(today) >= dayNumber(streak.cycleEndDate);
  const isWinner = cycleEnded && winningProgress >= minDays;
  const daysLeft = daysBetween(today, streak.cycleEndDate);
  const daysNeeded = Math.max(0, minDays - winningProgress);
  const canStillWin = daysNeeded <= daysLeft;

  if (isWinner) {
    const [won] = await db.update(customerStreaksTable)
      .set({ activeDays: activeDates.length, activeDayDates: activeDates, status: "won", wonAt: new Date() })
      .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")))
      .returning();
    if (won) await notifyWinner({ ...streak, ...won }, prize);
  } else {
    await db.update(customerStreaksTable).set({
      activeDays: activeDates.length,
      activeDayDates: activeDates,
      updatedAt: new Date(),
    }).where(eq(customerStreaksTable.id, streak.id));
  }

  return {
    streakCode: streak.streakCode,
    activeDays: activeDates.length,
    winningProgress,
    cycleLength,
    minDays,
    daysLeft,
    daysNeeded,
    isWinner,
    prize,
    status: isWinner ? "won" : "active",
    cycleStartDate: streak.cycleStartDate,
    cycleEndDate: streak.cycleEndDate,
    message: generateStreakMessage({
      activeDays: activeDates.length,
      winningProgress,
      cycleLength,
      minDays,
      daysLeft,
      daysNeeded,
      canStillWin,
      isWinner,
      prize,
      streakCode: streak.streakCode,
      customerName: streak.customerName ?? customerName ?? "Customer",
      cycleEnded,
    }),
  };
}

export async function getStreakSnapshot(phone: string): Promise<StreakSnapshot | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const rows = await db.select().from(customerStreaksTable)
    .where(eq(customerStreaksTable.customerPhone, normalized))
    .orderBy(desc(customerStreaksTable.updatedAt), desc(customerStreaksTable.id))
    .limit(5);
  const streak = rows.find(row => row.status === "active") ?? rows[0];
  if (!streak) return null;
  const prize = await getPrizeForStreak(streak);
  const winningProgress = streak.streakMode === "consecutive"
    ? longestConsecutiveRun(streak.activeDayDates)
    : streak.activeDayDates.length;
  const minDays = prize?.minDaysRequired ?? DEFAULT_MIN_DAYS;
  const daysLeft = streak.status === "active" ? daysBetween(todayUAE(), streak.cycleEndDate) : 0;
  const daysNeeded = Math.max(0, minDays - winningProgress);
  return {
    streakCode: streak.streakCode,
    activeDays: streak.activeDays,
    winningProgress,
    cycleLength: prize?.cycleLengthDays ?? daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1,
    minDays,
    daysLeft,
    daysNeeded,
    isWinner: streak.status === "won",
    prize,
    status: streak.status,
    cycleStartDate: streak.cycleStartDate,
    cycleEndDate: streak.cycleEndDate,
    message: generateStreakMessage({
      activeDays: streak.activeDays,
      winningProgress,
      cycleLength: prize?.cycleLengthDays ?? daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1,
      minDays,
      daysLeft,
      daysNeeded,
      canStillWin: daysNeeded <= daysLeft,
      isWinner: streak.status === "won",
      prize,
      streakCode: streak.streakCode,
      customerName: streak.customerName ?? "Customer",
      cycleEnded: streak.status !== "active",
    }),
    customerName: streak.customerName,
    customerPhone: streak.customerPhone,
  };
}

export async function processEndingStreaks(): Promise<number> {
  const today = todayUAE();
  const ending = await db.select().from(customerStreaksTable)
    .where(and(eq(customerStreaksTable.cycleEndDate, today), eq(customerStreaksTable.status, "active")));
  for (const streak of ending) await finalizeExpiredStreak(streak);
  return ending.length;
}