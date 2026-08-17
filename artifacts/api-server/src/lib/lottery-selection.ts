import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  lotteryDrawsTable,
  lotteryEntriesTable,
  lotteryWinnersTable,
} from "@workspace/db";

const FAIR_SELECTION_VERSION = "fair-rotation-v1";

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

  const selected: T[] = [];
  const selectedEntryIds = new Set<number>();
  const selectedCustomerKeys = new Set<string>();
  let recentWinnerCooldownApplied = false;
  let onePrizePerCustomerApplied = false;

  for (let slot = 0; slot < Math.max(0, Math.floor(winnerCount)); slot++) {
    const remaining = entries.filter(entry => !selectedEntryIds.has(entry.id));
    if (remaining.length === 0) break;

    // Keep the first pass to one prize per customer. If there are more prizes
    // than distinct customers, repeats become possible only after everyone has
    // received their first chance.
    const uniqueCustomerPool = remaining.filter(
      entry => !selectedCustomerKeys.has(customerKey(entry.customerPhone)),
    );
    const pool = uniqueCustomerPool.length > 0 ? uniqueCustomerPool : remaining;
    if (pool.length < remaining.length) onePrizePerCustomerApplied = true;

    // A previous-draw winner gets a cooldown when another customer is
    // available. This prevents back-to-back wins without making a draw
    // impossible when the eligible pool is small.
    const cooldownPool = pool.filter(
      entry => !recentWinnerKeys.has(customerKey(entry.customerPhone)),
    );
    const fairnessPool = cooldownPool.length > 0 ? cooldownPool : pool;
    if (cooldownPool.length > 0 && cooldownPool.length < pool.length) {
      recentWinnerCooldownApplied = true;
    }

    const minimumWinCount = Math.min(
      ...fairnessPool.map(entry => winsByCustomer.get(customerKey(entry.customerPhone)) ?? 0),
    );
    const lowestWinCountPool = fairnessPool.filter(
      entry => (winsByCustomer.get(customerKey(entry.customerPhone)) ?? 0) === minimumWinCount,
    );
    const entry = lowestWinCountPool[
      seededRandomIndex(seed, slot, lowestWinCountPool.length)
    ];

    selected.push(entry);
    selectedEntryIds.add(entry.id);
    const key = customerKey(entry.customerPhone);
    selectedCustomerKeys.add(key);
    winsByCustomer.set(key, (winsByCustomer.get(key) ?? 0) + 1);
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
    },
  };
}