import { and, asc, eq } from "drizzle-orm";
import {
  customersTable,
  db,
  lotteryEntriesTable,
  orderItemsTable,
  type Order,
} from "@workspace/db";

export function uaeDate(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
}

async function getOrderTicketCount(orderId: number): Promise<number> {
  const items = await db
    .select({ quantity: orderItemsTable.quantity })
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, orderId));

  const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);
  // A valid order normally has at least one item. Keep the historical
  // one-ticket behavior for legacy records with missing item rows.
  return Math.max(1, totalQuantity);
}

type LotteryEntry = typeof lotteryEntriesTable.$inferSelect;

type EnsureResult = {
  entries: LotteryEntry[];
  created: LotteryEntry[];
  reason?: string;
};

const inFlightEnsures = new Map<string, Promise<EnsureResult>>();

async function ensureLotteryEntriesForOrderUnserialized(
  order: Order,
  drawDate: string,
): Promise<EnsureResult> {
  if (order.status === "cancelled") {
    return { entries: [], created: [], reason: "Order is cancelled" };
  }

  const existing = await db
    .select()
    .from(lotteryEntriesTable)
    .where(and(eq(lotteryEntriesTable.orderId, order.id), eq(lotteryEntriesTable.drawDate, drawDate)))
    .orderBy(asc(lotteryEntriesTable.id));

  const targetCount = await getOrderTicketCount(order.id);
  if (existing.length >= targetCount) {
    return { entries: existing, created: [], reason: "Already in session" };
  }

  const customer = order.customerId
    ? (
        await db
          .select({ phone: customersTable.phone, name: customersTable.name })
          .from(customersTable)
          .where(eq(customersTable.id, order.customerId))
      )[0]
    : null;
  const phone = order.customerPhoneDirect ?? customer?.phone ?? null;
  if (!phone) {
    return { entries: existing, created: [], reason: "Order has no customer phone number" };
  }

  const created: LotteryEntry[] = [];
  const usedLuckyNumbers = new Set<number>();
  const needed = targetCount - existing.length;

  for (let index = 0; index < needed; index++) {
    let luckyNumber = 0;
    let unique = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      luckyNumber = Math.floor(100000 + Math.random() * 900000);
      if (usedLuckyNumbers.has(luckyNumber)) continue;

      const collision = await db
        .select({ id: lotteryEntriesTable.id })
        .from(lotteryEntriesTable)
        .where(
          and(
            eq(lotteryEntriesTable.branchId, order.branchId),
            eq(lotteryEntriesTable.drawDate, drawDate),
            eq(lotteryEntriesTable.luckyNumber, luckyNumber),
          ),
        );
      if (collision.length === 0) {
        unique = true;
        break;
      }
    }

    if (!unique) {
      return {
        entries: [...existing, ...created],
        created,
        reason: "Could not generate a unique lucky number",
      };
    }

    usedLuckyNumbers.add(luckyNumber);
    const [entry] = await db
      .insert(lotteryEntriesTable)
      .values({
        branchId: order.branchId,
        orderId: order.id,
        customerPhone: phone,
        customerName: order.customerNameDirect ?? customer?.name ?? null,
        luckyNumber,
        drawDate,
        luckyNumberSent: false,
      })
      .returning();
    created.push(entry);
  }

  return { entries: [...existing, ...created], created };
}

export function ensureLotteryEntriesForOrder(order: Order, drawDate: string): Promise<EnsureResult> {
  const key = `${order.id}:${drawDate}`;
  const inFlight = inFlightEnsures.get(key);
  if (inFlight) return inFlight;

  const promise = ensureLotteryEntriesForOrderUnserialized(order, drawDate).finally(() => {
    if (inFlightEnsures.get(key) === promise) inFlightEnsures.delete(key);
  });
  inFlightEnsures.set(key, promise);
  return promise;
}