/**
 * Player directory for /players picker — Supabase-first with local fallback.
 */

import { getDirectory } from "./directory";
import {
  emptyCurrencyBag,
  getPlayerLedgerStats,
  type CurrencyBag,
} from "./ledger";
import { fetchPlayersListRemote } from "./supabase/players-list";
import type { DirectoryEntry, LedgerEntry } from "./types";

export type DirectoryPickerEntry = DirectoryEntry & {
  netBalance: CurrencyBag;
  unsettledRounds: number;
};

export type LoadPlayerDirectoryResult = {
  outcome: "cloud" | "local";
  players: DirectoryPickerEntry[];
};

function enrichEntry(
  entry: DirectoryEntry,
  ledger: LedgerEntry[],
): DirectoryPickerEntry {
  const stats = getPlayerLedgerStats(entry.normalizedContactKey, ledger);
  return {
    ...entry,
    netBalance: stats?.net ?? emptyCurrencyBag(),
    unsettledRounds: stats?.unsettledRounds ?? 0,
  };
}

function mergeDirectoryEntries(
  remote: DirectoryEntry[],
  local: DirectoryEntry[],
  ledger: LedgerEntry[],
): DirectoryPickerEntry[] {
  const byKey = new Map<string, DirectoryEntry>();
  for (const entry of local) {
    if (entry.normalizedContactKey) {
      byKey.set(entry.normalizedContactKey, entry);
    }
  }
  for (const entry of remote) {
    if (entry.normalizedContactKey) {
      byKey.set(entry.normalizedContactKey, entry);
    }
  }
  return [...byKey.values()]
    .map((entry) => enrichEntry(entry, ledger))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function loadPlayerDirectoryForPicker(
  ledger: LedgerEntry[],
): Promise<LoadPlayerDirectoryResult> {
  const localEntries = Object.values(getDirectory());
  const remote = await fetchPlayersListRemote();

  if (remote.ok) {
    return {
      outcome: "cloud",
      players: mergeDirectoryEntries(remote.players, localEntries, ledger),
    };
  }

  return {
    outcome: "local",
    players: localEntries
      .map((entry) => enrichEntry(entry, ledger))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

export function filterDirectoryPickerEntries(
  entries: DirectoryPickerEntry[],
  query: string,
): DirectoryPickerEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return entries;

  const queryDigits = trimmed.replace(/\D+/g, "");

  return entries.filter((entry) => {
    if (entry.displayName.toLowerCase().includes(trimmed)) return true;
    if (entry.email?.toLowerCase().includes(trimmed)) return true;
    if (entry.phone?.toLowerCase().includes(trimmed)) return true;
    if (queryDigits) {
      const phoneDigits = entry.phone?.replace(/\D+/g, "") ?? "";
      if (phoneDigits.includes(queryDigits)) return true;
    }
    return false;
  });
}

export function contactLabel(entry: DirectoryEntry): string {
  if (entry.email) return entry.email;
  if (entry.phone) return entry.phone;
  return "No email or phone on file";
}
