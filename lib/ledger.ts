/**
 * Cross-round unsettled-debt ledger — localStorage cache layer.
 *
 * App code should use `lib/ledger-service.ts` for reads/writes (Supabase
 * primary, local fallback). This module holds the `gbl_ledger_entries`
 * cache and pure helpers used by the service + stats on `/players`.
 */

import type {
  Currency,
  LedgerEntry,
  LedgerStatus,
  LedgerSyncState,
  RoundDetails,
} from "./types";

export const LEDGER_KEY = "gbl_ledger_entries";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(): string {
  if (isBrowser() && "crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `l_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function getLedger(): LedgerEntry[] {
  if (!isBrowser()) return [];
  const parsed = safeParse<LedgerEntry[]>(
    window.localStorage.getItem(LEDGER_KEY),
  );
  return Array.isArray(parsed) ? parsed : [];
}

function writeLedger(entries: LedgerEntry[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
}

export type LedgerQuery = {
  contactKey?: string;
  roundId?: string;
  excludeRoundId?: string;
  statuses?: LedgerStatus[];
};

export function findLedgerEntries(
  query: LedgerQuery = {},
  source?: ReadonlyArray<LedgerEntry>,
): LedgerEntry[] {
  const { contactKey, roundId, excludeRoundId, statuses } = query;
  const all = source ?? getLedger();
  return all.filter((e) => {
    if (
      contactKey &&
      e.payerContactKey !== contactKey &&
      e.receiverContactKey !== contactKey
    ) {
      return false;
    }
    if (roundId && e.roundId !== roundId) return false;
    if (excludeRoundId && e.roundId === excludeRoundId) return false;
    if (statuses && !statuses.includes(e.status)) return false;
    return true;
  });
}

/** Stable dedupe key per product spec (not roundId). */
export type LedgerDuplicateFields = Pick<
  LedgerEntry,
  | "roundName"
  | "courseName"
  | "date"
  | "payerContactKey"
  | "receiverContactKey"
  | "amount"
>;

export function ledgerDuplicateKey(
  entry: LedgerDuplicateFields,
): string {
  return [
    entry.roundName ?? "",
    entry.courseName ?? "",
    entry.date,
    entry.payerContactKey,
    entry.receiverContactKey,
    entry.amount.toFixed(2),
  ].join("\0");
}

export function isDuplicateLedgerEntry(
  a: LedgerDuplicateFields,
  b: LedgerDuplicateFields,
): boolean {
  return ledgerDuplicateKey(a) === ledgerDuplicateKey(b);
}

export function findDuplicateLedgerEntry(
  entries: ReadonlyArray<LedgerEntry>,
  candidate: LedgerDuplicateFields,
): LedgerEntry | undefined {
  return entries.find((e) => isDuplicateLedgerEntry(e, candidate));
}

/**
 * Merge remote unsettled rows with the full local cache. When the same
 * logical debt exists in both, keep the local `id` but adopt the remote
 * uuid + field snapshot so status updates can hit Supabase.
 */
export function mergeLedgerEntries(
  local: LedgerEntry[],
  remote: LedgerEntry[],
): LedgerEntry[] {
  const map = new Map<string, LedgerEntry>();
  for (const e of local) {
    map.set(ledgerDuplicateKey(e), e);
  }
  for (const remoteRow of remote) {
    const key = ledgerDuplicateKey(remoteRow);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, remoteRow);
      continue;
    }
    map.set(key, {
      ...prev,
      ...remoteRow,
      id: prev.id,
      supabaseId: remoteRow.supabaseId ?? prev.supabaseId,
      syncState: "cloud",
    });
  }
  return [...map.values()];
}

type LocalLedgerWriteInput = Omit<
  LedgerEntry,
  "id" | "createdAt" | "updatedAt" | "supabaseId" | "syncState"
>;

/** Append or replace-by-duplicate-key in localStorage. Used by ledger-service. */
export function writeLocalLedgerEntry(
  input: LocalLedgerWriteInput & {
    id?: string;
    supabaseId?: string;
    syncState?: LedgerSyncState;
  },
): LedgerEntry {
  const now = nowIso();
  const entry: LedgerEntry = {
    ...input,
    id: input.id ?? generateId(),
    createdAt: now,
    updatedAt: now,
  };
  const entries = getLedger();
  const key = ledgerDuplicateKey(entry);
  const idx = entries.findIndex((e) => ledgerDuplicateKey(e) === key);
  if (idx === -1) entries.push(entry);
  else entries[idx] = { ...entries[idx], ...entry, id: entries[idx].id };
  writeLedger(entries);
  return entries.find((e) => ledgerDuplicateKey(e) === key) ?? entry;
}

/** Patch one local row by local id. */
export function upsertLocalLedgerEntry(
  id: string,
  patch: Partial<LedgerEntry>,
): LedgerEntry | undefined {
  const entries = getLedger();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return undefined;
  const next = { ...entries[idx], ...patch, updatedAt: nowIso() };
  entries[idx] = next;
  writeLedger(entries);
  return next;
}

/** Currency-keyed money bag, used by the stats helpers. */
export type CurrencyBag = Record<Currency, number>;

export function emptyCurrencyBag(): CurrencyBag {
  return { CAD: 0, USD: 0 };
}

function isUnpaid(status: LedgerStatus): boolean {
  return status === "pending" || status === "disputed";
}

/** Context for excluding the round currently being settled on `/results`. */
export type CurrentRoundLedgerContext = {
  roundId?: string;
  supabaseRoundId?: string;
  date: string;
  courseName?: string;
  roundName?: string;
};

export function currentRoundLedgerContextFromDetails(
  roundId: string,
  details: Pick<RoundDetails, "date" | "courseName" | "roundName">,
  supabaseRoundId?: string,
): CurrentRoundLedgerContext {
  return {
    roundId,
    supabaseRoundId,
    date: details.date,
    courseName: details.courseName,
    roundName: details.roundName,
  };
}

/** True when a ledger row belongs to the in-progress round (local id or metadata). */
export function isCurrentRoundLedgerEntry(
  entry: LedgerEntry,
  ctx: CurrentRoundLedgerContext,
): boolean {
  if (ctx.roundId && entry.roundId && entry.roundId === ctx.roundId) {
    return true;
  }
  if (
    ctx.supabaseRoundId &&
    entry.roundId &&
    entry.roundId === ctx.supabaseRoundId
  ) {
    return true;
  }
  return (
    entry.date === ctx.date &&
    (entry.courseName ?? "") === (ctx.courseName ?? "") &&
    (entry.roundName ?? "") === (ctx.roundName ?? "")
  );
}

/**
 * Pending/disputed rows for one contact key from prior rounds (excludes
 * the current round snapshot on the results page).
 */
export function getPriorUnsettledEntriesForContact(
  ledger: ReadonlyArray<LedgerEntry>,
  contactKey: string,
  ctx: CurrentRoundLedgerContext,
): LedgerEntry[] {
  return ledger.filter(
    (e) =>
      isUnpaid(e.status) &&
      (e.payerContactKey === contactKey ||
        e.receiverContactKey === contactKey) &&
      !isCurrentRoundLedgerEntry(e, ctx),
  );
}

export type PlayerLedgerStats = {
  owes: CurrencyBag;
  owed: CurrencyBag;
  net: CurrencyBag;
  unsettledRounds: number;
  unsettledEntries: number;
};

export function getPlayerLedgerStats(
  contactKey: string | undefined,
  preloaded?: ReadonlyArray<LedgerEntry>,
): PlayerLedgerStats {
  const owes = emptyCurrencyBag();
  const owed = emptyCurrencyBag();
  const net = emptyCurrencyBag();
  const rounds = new Set<string>();
  let count = 0;
  if (!contactKey) {
    return { owes, owed, net, unsettledRounds: 0, unsettledEntries: 0 };
  }
  const all = preloaded ?? getLedger();
  for (const e of all) {
    if (!isUnpaid(e.status)) continue;
    const payer = e.payerContactKey === contactKey;
    const receiver = e.receiverContactKey === contactKey;
    if (!payer && !receiver) continue;
    rounds.add(e.roundId || e.date);
    count += 1;
    if (payer) {
      owes[e.currency] += e.amount;
      net[e.currency] += e.amount;
    }
    if (receiver) {
      owed[e.currency] += e.amount;
      net[e.currency] -= e.amount;
    }
  }
  return { owes, owed, net, unsettledRounds: rounds.size, unsettledEntries: count };
}

export type AggregateLedgerStats = {
  roundsPlayed: number;
  outstandingTotal: CurrencyBag;
  pendingCount: number;
  largestOutstanding: { currency: Currency; amount: number } | null;
};

export function getAggregateLedgerStats(
  contactKeys: ReadonlySet<string> | ReadonlyArray<string>,
  preloaded?: ReadonlyArray<LedgerEntry>,
): AggregateLedgerStats {
  const keys =
    contactKeys instanceof Set
      ? contactKeys
      : new Set<string>(contactKeys);
  const outstanding = emptyCurrencyBag();
  const rounds = new Set<string>();
  let pendingCount = 0;
  let largest: AggregateLedgerStats["largestOutstanding"] = null;

  const all = preloaded ?? getLedger();
  for (const e of all) {
    const involves =
      keys.has(e.payerContactKey) || keys.has(e.receiverContactKey);
    if (!involves) continue;
    rounds.add(e.roundId || e.date);
    if (e.status === "pending") pendingCount += 1;
    if (isUnpaid(e.status)) {
      outstanding[e.currency] += e.amount;
      if (!largest || e.amount > largest.amount) {
        largest = { currency: e.currency, amount: e.amount };
      }
    }
  }
  return {
    roundsPlayed: rounds.size,
    outstandingTotal: outstanding,
    pendingCount,
    largestOutstanding: largest,
  };
}
