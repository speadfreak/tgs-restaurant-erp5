import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  lotteryDrawsTable,
  lotteryEntriesTable,
  lotteryWinnersTable,
  ordersTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

const FAIR_SELECTION_VERSION = "fair-ticket-volume-v3";

export type LotterySelectionEntry = {
  id: number;
  customerPhone: string;
};

export type LotteryWinnerHistory = {
  customerPhone: string;
  drawDate: string;
};

export type LotterySelectionSummary = {
  algorithmVersion: string;
  eligibleEntries: number;
  eligibleCustomers: number;
  historicalWinnerCustomers: number;
  latestPreviousDrawDate: string | null;
  recentWinnerCooldownApplied: boolean;
  onePrizePerCustomerApplied: boolean;
  orderVolumeWeightingApplied: boolean;
  oneTicketPerOrderApplied: boolean;
};

export function uaeDate(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
}

export async function loadLotteryWinnerHistory(branchId: number): Promise<LotteryWinnerHistory[]> {
  return db.select({
    customerPhone: lotteryEntriesTable.customerPhone,
    drawDate: lotteryDrawsTable.drawDate,
  })
    .from(lotteryWinnersTable)
    .innerJoin(lotteryEntriesTable, eq(lotteryWinnersTable.entryId, lotteryEntriesTable.id))
    .innerJoin(lotteryDrawsTable, eq(lotteryWinnersTable.drawId, lotteryDrawsTable.id))
    .where(and(
      eq(lotteryDrawsTable.branchId, branchId),
      eq(lotteryDrawsTable.status, "completed"),
    ));
}

/**
 * Cancelled orders must never participate in a draw, even if an older
 * lottery entry survived the cancellation cleanup.
 */
export async function filterCancelledLotteryEntries<T extends { orderId: number }>(entries: T[]): Promise<T[]> {
  if (entries.length === 0) return entries;

  const orderIds = [...new Set(entries.map(entry => entry.orderId))];
  const orders = await db
    .select({ id: ordersTable.id, status: ordersTable.status })
    .from(ordersTable)
    .where(inArray(ordersTable.id, orderIds));
  const cancelledOrderIds = new Set(
    orders.filter(order => order.status === "cancelled").map(order => order.id),
  );

  return entries.filter(entry => !cancelledOrderIds.has(entry.orderId));
}

function customerKey(phone: string): string {
  return phone.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
}

function seededRandomIndex(seed: string, counter: number, max: number): number {
  if (max <= 1) return 0;

  // Rejection sampling avoids modulo bias while keeping every draw auditable
  // from the stored seed and deterministic for a given candidate pool.
  const range = 0x1_0000_0000;
  const limit = range - (range % max);
  let attempt = 0;
  while (true) {
    const digest = crypto.createHash("sha256")
      .update(`${seed}:${counter}:${attempt}`)
      .digest();
    const value = digest.readUInt32BE(0);
    if (value < limit) return value % max;
    attempt++;
  }
}

function seededRandomFraction(seed: string, counter: number): number {
  const digest = crypto.createHash("sha256")
    .update(`${seed}:${counter}:fraction`)
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

function weightedRandomIndex(weights: number[], seed: string, counter: number): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length <= 1 || totalWeight <= 0) return 0;

  let target = seededRandomFraction(seed, counter) * totalWeight;
  for (let index = 0; index < weights.length; index++) {
    target -= weights[index];
    if (target < 0) return index;
  }
  return weights.length - 1;
}

export function selectFairWinners<T extends LotterySelectionEntry>(
  entries: T[],
  history: LotteryWinnerHistory[],
  winnerCount: number,
  seed: string,
): { winners: T[]; summary: LotterySelectionSummary } {
  const normalizedHistory = history.map(row => ({
    customerKey: customerKey(row.customerPhone),
    drawDate: row.drawDate,
  }));
  const winsByCustomer = new Map<string, number>();
  for (const row of normalizedHistory) {
    winsByCustomer.set(row.customerKey, (winsByCustomer.get(row.customerKey) ?? 0) + 1);
  }

  const latestPreviousDrawDate = normalizedHistory.reduce<string | null>(
    (latest, row) => latest === null || row.drawDate > latest ? row.drawDate : latest,
    null,
  );
  const recentWinnerKeys = new Set(
    normalizedHistory
      .filter(row => row.drawDate === latestPreviousDrawDate)
      .map(row => row.customerKey),
  );
  const eligibleCustomerKeys = new Set(entries.map(entry => customerKey(entry.customerPhone)));
  const historicalWinnerCustomers = [...winsByCustomer.keys()]
    .filter(key => eligibleCustomerKeys.has(key)).length;

  const entriesByCustomer = new Map<string, T[]>();
  for (const entry of entries) {
    const key = customerKey(entry.customerPhone);
    const customerEntries = entriesByCustomer.get(key) ?? [];
    customerEntries.push(entry);
    entriesByCustomer.set(key, customerEntries);
  }

  const selected: T[] = [];
  const selectedEntryIds = new Set<number>();
  const selectedCustomerKeys = new Set<string>();
  let recentWinnerCooldownApplied = false;
  let onePrizePerCustomerApplied = false;

  for (let slot = 0; slot < Math.max(0, Math.floor(winnerCount)); slot++) {
    const remainingByCustomer = [...entriesByCustomer.entries()]
      .map(([key, customerEntries]) => [
        key,
        customerEntries.filter(entry => !selectedEntryIds.has(entry.id)),
      ] as const)
      .filter(([, customerEntries]) => customerEntries.length > 0);
    if (remainingByCustomer.length === 0) break;

    // Keep the first pass to one prize per customer. If there are more prizes
    // than distinct customers, repeats become possible only after everyone has
    // received their first chance.
    const uniqueCustomerPool = remainingByCustomer.filter(
      ([key]) => !selectedCustomerKeys.has(key),
    );
    const customerPool = uniqueCustomerPool.length > 0 ? uniqueCustomerPool : remainingByCustomer;
    if (uniqueCustomerPool.length < remainingByCustomer.length) onePrizePerCustomerApplied = true;

    // A previous-draw winner gets a cooldown when another customer is
    // available. This prevents back-to-back wins without making a draw
    // impossible when the eligible pool is small.
    const cooldownPool = customerPool.filter(
      ([key]) => !recentWinnerKeys.has(key),
    );
    const fairnessPool = cooldownPool.length > 0 ? cooldownPool : customerPool;
    if (cooldownPool.length > 0 && cooldownPool.length < customerPool.length) {
      recentWinnerCooldownApplied = true;
    }

    // Every order is one real ticket. This makes a customer with three orders
    // three times as likely as a customer with one order in the same fairness
    // group. Previous wins reduce the weight, while the one-prize cap protects
    // the draw from being monopolized by a high-volume customer.
    const weights = fairnessPool.map(([key, customerEntries]) => {
      const orderVolumeWeight = customerEntries.length;
      const historicalWinPenalty = 1 / (1 + (winsByCustomer.get(key) ?? 0));
      return orderVolumeWeight * historicalWinPenalty;
    });
    const selectedCustomerIndex = weightedRandomIndex(weights, seed, slot);
    const [selectedKey, selectedCustomerEntries] = fairnessPool[selectedCustomerIndex];
    const entry = selectedCustomerEntries[
      seededRandomIndex(seed, slot + 10_000, selectedCustomerEntries.length)
    ];

    selected.push(entry);
    selectedEntryIds.add(entry.id);
    selectedCustomerKeys.add(selectedKey);
    winsByCustomer.set(selectedKey, (winsByCustomer.get(selectedKey) ?? 0) + 1);
  }

  return {
    winners: selected,
    summary: {
      algorithmVersion: FAIR_SELECTION_VERSION,
      eligibleEntries: entries.length,
      eligibleCustomers: eligibleCustomerKeys.size,
      historicalWinnerCustomers,
      latestPreviousDrawDate,
      recentWinnerCooldownApplied,
      onePrizePerCustomerApplied,
      orderVolumeWeightingApplied: true,
      oneTicketPerOrderApplied: true,
    },
  };
}