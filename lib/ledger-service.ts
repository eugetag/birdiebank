/**
 * Ledger service — primary API for reading/writing cross-round debts.
 *
 * Supabase `ledger_entries` is the source of truth when configured.
 * localStorage (`gbl_ledger_entries`) is always updated as a cache /
 * offline fallback.
 *
 * Public surface:
 *   - getLedgerEntries()
 *   - saveLedgerEntry(entry)
 *   - updateLedgerStatus(entryId, status)
 */

import {
  getLedger,
  mergeLedgerEntries,
  upsertLocalLedgerEntry,
  writeLocalLedgerEntry,
} from "./ledger";
import { getDraftSupabaseRoundId } from "./rounds-service";
import type { SupabaseErrorDetails } from "./supabase/errors";
import {
  fetchUnsettledLedgerRemote,
  insertLedgerEntryRemote,
  updateLedgerStatusRemote,
} from "./supabase/ledger";
import type { LedgerEntry, LedgerStatus } from "./types";

export type { SupabaseErrorDetails };

export type LedgerSaveInput = Omit<
  LedgerEntry,
  "id" | "createdAt" | "updatedAt" | "supabaseId" | "syncState"
>;

export type SaveLedgerOutcome = "cloud" | "local" | "exists" | "error";

export type SaveLedgerResult = {
  outcome: SaveLedgerOutcome;
  entry: LedgerEntry;
  /** Populated when `outcome === "error"` or unconfigured remote insert. */
  remoteError?: SupabaseErrorDetails;
};

export type UpdateLedgerOutcome = "cloud" | "local" | "error";

export type UpdateLedgerResult = {
  outcome: UpdateLedgerOutcome;
  entry?: LedgerEntry;
};

export type GetLedgerEntriesOptions = {
  /** When set, remote fetch returns pending/disputed rows for these keys. */
  contactKeys?: ReadonlyArray<string>;
};

/**
 * Load ledger rows: Supabase pending/disputed (when keys provided) merged
 * with the full localStorage cache. Remote wins on duplicate keys.
 */
export async function getLedgerEntries(
  options: GetLedgerEntriesOptions = {},
): Promise<LedgerEntry[]> {
  const local = getLedger();
  const keys = options.contactKeys?.filter(Boolean) ?? [];
  if (keys.length === 0) return local;

  const remoteResult = await fetchUnsettledLedgerRemote(keys);
  if (!remoteResult.ok) return local;
  return mergeLedgerEntries(local, remoteResult.entries);
}

/**
 * Save a ledger entry. Tries Supabase `insert()` first; on failure writes
 * localStorage only.
 *
 * Duplicate prevention is temporarily disabled while debugging sync
 * failures — every click attempts a direct insert.
 */
export async function saveLedgerEntry(
  input: LedgerSaveInput,
): Promise<SaveLedgerResult> {
  const remoteResult = await insertLedgerEntryRemote(input, {
    supabaseRoundId: getDraftSupabaseRoundId(),
  });

  if (remoteResult.ok) {
    const entry = writeLocalLedgerEntry({
      ...input,
      supabaseId: remoteResult.supabaseId,
      syncState: "cloud",
      id: remoteResult.supabaseId,
    });
    return { outcome: "cloud", entry };
  }

  const entry = writeLocalLedgerEntry({
    ...input,
    syncState: remoteResult.reason === "unconfigured" ? "local" : "error",
  });
  return {
    outcome: remoteResult.reason === "unconfigured" ? "local" : "error",
    entry,
    remoteError: remoteResult.errorInfo,
  };
}

function resolveEntry(entryId: string): LedgerEntry | undefined {
  const entries = getLedger();
  return entries.find((e) => e.id === entryId || e.supabaseId === entryId);
}

/**
 * Update status: Supabase first (when `supabaseId` is known), then patch
 * the localStorage cache.
 */
export async function updateLedgerStatus(
  entryId: string,
  status: LedgerStatus,
): Promise<UpdateLedgerResult> {
  const entry = resolveEntry(entryId);
  if (!entry) return { outcome: "error" };

  if (entry.supabaseId) {
    const remoteResult = await updateLedgerStatusRemote(
      entry.supabaseId,
      status,
    );
    if (!remoteResult.ok) {
      const cached = upsertLocalLedgerEntry(entry.id, {
        status,
        syncState: "error",
      });
      return { outcome: "error", entry: cached };
    }
  }

  const cached = upsertLocalLedgerEntry(entry.id, {
    status,
    syncState: entry.supabaseId ? "cloud" : "local",
  });
  if (!cached) return { outcome: "error" };
  return { outcome: entry.supabaseId ? "cloud" : "local", entry: cached };
}

/** Re-export duplicate helpers for UI row matching. */
export { findDuplicateLedgerEntry, ledgerDuplicateKey } from "./ledger";
