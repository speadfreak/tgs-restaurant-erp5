import { randomBytes } from "crypto";
import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
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

function isHumanCustomerName(value: string | null | undefined): boolean {
  const name = value?.trim() ?? "";
  return Boolean(name && /\p{L}/u.test(name) && !/^customer(?:\s*#.*)?$/i.test(name));
}

function createStreakCode(): string {
  return `STK-${randomBytes(4).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6).padEnd(6, "0")}`;
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

async function createNewStreak(phone: string, name: string, branchId: number, code?: string): Promise<CustomerStreak> {
  const prize = await getActivePrize(branchId);
  const targetOrders = prizeOrderTarget(prize);
  const cycleLength = prize?.cycleLengthDays ?? (Number(await getSetting("streak_default_cycle_length")) || DEFAULT_CYCLE_LENGTH);
  const start = todayUAE();
  const customerName = name.trim() || "Customer";
  const [streak] = await db.insert(customerStreaksTable).values({
    customerPhone: phone,
    customerName,
    streakCode: code ?? await ensureCustomerCode(phone, customerName),
    branchId,
    cycleStartDate: start,
    cycleEndDate: addDays(start, cycleLength - 1),
    activeDays: 0,
    orderCount: 0,
    targetOrders,
    activeDayDates: [],
    streakMode: "window",
    status: "active",
    prizeId: prize?.id ?? null,
  }).returning();
  if (!streak) throw new Error("Could not create customer challenge");
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

async function getStreakProgress(streak: CustomerStreak): Promise<StreakProgress> {
  const rows = await db.select({
    activeDate: streakActiveDaysTable.activeDate,
  }).from(streakActiveDaysTable)
    .where(eq(streakActiveDaysTable.streakId, streak.id))
    .orderBy(asc(streakActiveDaysTable.activeDate), asc(streakActiveDaysTable.id));

  // Rows are now one per delivered order. The fallback keeps older day-based
  // records visible until their first order is added after this upgrade.
  const orderCount = rows.length || streak.orderCount || streak.activeDays || streak.activeDayDates.length;
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

function generateStreakMessage(params: {
  ordersCompleted: number;
  minOrders: number;
  daysLeft: number;
  ordersRemaining: number;
  isWinner: boolean;
  prize: StreakPrize | null;
  streakCode: string;
  cycleEnded: boolean;
}): StreakMessage {
  const { ordersCompleted, minOrders, daysLeft, ordersRemaining, isWinner, prize, streakCode, cycleEnded } = params;
  const prizeName = displayPrizeName(prize);

  if (isWinner && prize) {
    return {
      en: `🎉 FOODIE CHALLENGE COMPLETE!\nYou completed ${ordersCompleted}/${minOrders} orders and won ${prizeName}! Please claim your prize on your next visit.\n\n🎫 Challenge code: ${streakCode}`,
      am: `🎉 የትዕዛዝ ፈተናው ተጠናቀቀ!\nበዚህ ዙር ${ordersCompleted}/${minOrders} የትዕዛዝ ጊዜ አጠናቀው ${prizeName} አሸንፈዋል! ሽልማትዎን ለመውሰድ በሚቀጥለው ጉብኝትዎ ይምጡ።\n\n🎫 የፈተና ኮድ: ${streakCode}`,
    };
  }

  if (cycleEnded) {
    return {
      en: `This round ended at ${ordersCompleted}/${minOrders} orders. Your next foodie challenge starts with your next delicious order — see you soon!\n\n🎫 Challenge code: ${streakCode}`,
      am: `ይህ ዙር ${ordersCompleted}/${minOrders} የትዕዛዝ ጊዜ ላይ አብቅቷል። በሚቀጥለው ትዕዛዝዎ አዲስ የትዕዛዝ ፈተና ይጀምራል — በቅርቡ እንገናኝ!\n\n🎫 የፈተና ኮድ: ${streakCode}`,
    };
  }

  if (ordersRemaining > 0) {
    const orderWord = ordersRemaining === 1 ? "order" : "orders";
    const orderWordAm = ordersRemaining === 1 ? "የትዕዛዝ ጊዜ" : "የትዕዛዝ ጊዜዎች";
    return {
      en: `Just ${ordersRemaining} more ${orderWord} of delicious meals to score ${prizeName}! You've completed ${ordersCompleted}/${minOrders} orders this cycle. See you next order!${daysLeft === 0 ? " Today is the final day." : ""}\n\n🎫 Challenge code: ${streakCode}`,
      am: `${ordersRemaining} ${orderWordAm} ብቻ ${prizeName} ለማግኘት ቀርተዋል! በዚህ ዙር ${ordersCompleted}/${minOrders} አጠናቀዋል። በቀጣይ ትዕዛዝ እንገናኝ!${daysLeft === 0 ? " ዛሬ የመጨረሻ ቀን ነው።" : ""}\n\n🎫 የፈተና ኮድ: ${streakCode}`,
    };
  }

  return {
    en: `You're on a delicious roll! You've completed ${ordersCompleted}/${minOrders} orders this cycle. Keep the good food coming!\n\n🎫 Challenge code: ${streakCode}`,
    am: `በጣፋጭ ጉዞ ላይ ነዎት! በዚህ ዙር ${ordersCompleted}/${minOrders} አጠናቀዋል። ጣፋጭ ትዕዛዝዎን ይቀጥሉ!\n\n🎫 የፈተና ኮድ: ${streakCode}`,
  };
}

async function notifyWinner(streak: CustomerStreak, prize: StreakPrize | null, progress: StreakProgress): Promise<void> {
  if ((await getSetting("streak_auto_notification")) === "false" || !prize) return;
  const target = streakOrderTarget(streak, prize);
  const message = generateStreakMessage({
    ordersCompleted: progress.orderCount,
    minOrders: target,
    daysLeft: 0,
    ordersRemaining: 0,
    isWinner: true,
    prize,
    streakCode: streak.streakCode,
    cycleEnded: true,
  });
  const result = await sendWhatsAppMessage(streak.customerPhone, `${message.am}\n\n${message.en}`);
  if (result.ok) {
    await db.update(customerStreaksTable).set({ notifiedAt: new Date() }).where(eq(customerStreaksTable.id, streak.id));
  }
}

async function finalizeExpiredStreak(streak: CustomerStreak): Promise<void> {
  const prize = await getPrizeForStreak(streak);
  const progress = await getStreakProgress(streak);
  const target = streakOrderTarget(streak, prize);
  await syncStreakProgress(streak, progress);

  if (progress.orderCount >= target) {
    const [won] = await db.update(customerStreaksTable)
      .set({ status: "won", wonAt: new Date() })
      .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")))
      .returning();
    if (won) await notifyWinner({ ...streak, ...won }, prize, progress);
    return;
  }

  await db.update(customerStreaksTable)
    .set({ status: "lost" })
    .where(and(eq(customerStreaksTable.id, streak.id), eq(customerStreaksTable.status, "active")));

  if ((await getSetting("streak_reset_notification")) === "true") {
    const resetMessage = generateStreakMessage({
      ordersCompleted: progress.orderCount,
      minOrders: target,
      daysLeft: 0,
      ordersRemaining: Math.max(0, target - progress.orderCount),
      isWinner: false,
      prize,
      streakCode: streak.streakCode,
      cycleEnded: true,
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
): Promise<StreakResult | null> {
  if ((await getSetting("streak_enabled")) === "false") return null;
  const phone = normalizePhone(customerPhone);
  if (!phone) return null;
  const displayName = customerName.trim();
  const today = todayUAE();
  let streak = await getActiveStreak(phone);

  if (streak && dayNumber(today) > dayNumber(streak.cycleEndDate)) {
    await finalizeExpiredStreak(streak);
    streak = await getActiveStreak(phone);
  }
  if (!streak) {
    const code = await ensureCustomerCode(phone, displayName);
    streak = await createNewStreak(phone, displayName, branchId, code);
  }
  if (isHumanCustomerName(displayName) && !isHumanCustomerName(streak.customerName)) {
    await db.update(customerStreaksTable)
      .set({ customerName: displayName, updatedAt: new Date() })
      .where(eq(customerStreaksTable.id, streak.id));
    streak = { ...streak, customerName: displayName };
  }

  await db.insert(streakActiveDaysTable).values({
    streakId: streak.id,
    activeDate: today,
    orderId,
  }).onConflictDoNothing();

  const progress = await getStreakProgress(streak);
  const prize = await getPrizeForStreak(streak);
  const cycleLength = daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1;
  const minOrders = streakOrderTarget(streak, prize);
  const cycleEnded = dayNumber(today) > dayNumber(streak.cycleEndDate);
  const isWinner = !cycleEnded && progress.orderCount >= minOrders;
  const daysLeft = daysBetween(today, streak.cycleEndDate);
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
    if (won) await notifyWinner({ ...streak, ...won }, prize, progress);
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
    message: generateStreakMessage({
      ordersCompleted: progress.orderCount,
      minOrders,
      daysLeft,
      ordersRemaining,
      isWinner,
      prize,
      streakCode: streak.streakCode,
      cycleEnded,
    }),
  };
}

export async function getStreakSnapshot(phone: string): Promise<StreakSnapshot | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  let rows = await db.select().from(customerStreaksTable)
    .where(eq(customerStreaksTable.customerPhone, normalized))
    .orderBy(desc(customerStreaksTable.updatedAt), desc(customerStreaksTable.id))
    .limit(5);
  let streak = rows.find(row => row.status === "active") ?? rows[0];
  if (!streak) return null;

  if (streak.status === "active" && dayNumber(todayUAE()) > dayNumber(streak.cycleEndDate)) {
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
  const daysLeft = streak.status === "active" ? daysBetween(todayUAE(), streak.cycleEndDate) : 0;
  const ordersRemaining = Math.max(0, minOrders - progress.orderCount);
  return {
    streakCode: streak.streakCode,
    activeDays: progress.activeDates.length,
    ordersCompleted: progress.orderCount,
    winningProgress: progress.orderCount,
    cycleLength: daysBetween(streak.cycleStartDate, streak.cycleEndDate) + 1,
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
    message: generateStreakMessage({
      ordersCompleted: progress.orderCount,
      minOrders,
      daysLeft,
      ordersRemaining,
      isWinner: streak.status === "won",
      prize,
      streakCode: streak.streakCode,
      cycleEnded: streak.status !== "active",
    }),
    customerName: streak.customerName,
    customerPhone: streak.customerPhone,
  };
}

export async function processEndingStreaks(): Promise<number> {
  const today = todayUAE();
  const ending = await db.select().from(customerStreaksTable).where(
    and(lt(customerStreaksTable.cycleEndDate, today), eq(customerStreaksTable.status, "active")),
  );
  for (const streak of ending) await finalizeExpiredStreak(streak);
  return ending.length;
}