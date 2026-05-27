/**
 * Cross-round player directory.
 *
 * Persists at `gbl_player_directory` as a map keyed by `normalizedContactKey`.
 * The map shape keeps lookups O(1) and dedupe trivial. The data model is
 * intentionally Supabase-friendly: every entry is a flat row with stable
 * timestamps and a primary key (`id`) that survives key recomputation.
 */

import { upsertPlayerRemote, type PlayersRemoteResult } from "./supabase/players";
import type { DirectoryEntry } from "./types";

export type SaveDirectoryEntryResult = {
  /** The freshly written directory entry — already persisted to localStorage. */
  entry: DirectoryEntry;
  /**
   * Resolves with the outcome of the Supabase mirror upsert. Never rejects:
   * Supabase failures (unconfigured, RLS, network) are surfaced via the
   * structured `PlayersRemoteResult`. Callers that want to display
   * "Saved to Cloud" vs "Local fallback" should `await` this; callers that
   * just need the local entry can ignore it.
   */
  remote: Promise<PlayersRemoteResult>;
};

export const DIRECTORY_KEY = "gbl_player_directory";

export type DirectoryMap = Record<string, DirectoryEntry>;

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
  return `d_${Date.now().toString(36)}_${Math.random()
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

/**
 * Compute the stable contact key for a player according to the spec:
 * 1. lowercased / trimmed email,
 * 2. else digits-only phone,
 * 3. else the player's local id (temporary guest).
 */
export function normalizeContactKey(input: {
  email?: string;
  phone?: string;
  fallbackId: string;
}): string {
  const email = input.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const digits = input.phone?.replace(/\D+/g, "") ?? "";
  if (digits) return `phone:${digits}`;
  return `guest:${input.fallbackId}`;
}

/** Reverse `normalizeContactKey` for Supabase upserts (guest keys have no contact). */
export function parseContactKey(key: string): {
  email?: string;
  phone?: string;
} {
  if (key.startsWith("email:")) {
    return { email: key.slice("email:".length) };
  }
  if (key.startsWith("phone:")) {
    return { phone: key.slice("phone:".length) };
  }
  return {};
}

export function getDirectory(): DirectoryMap {
  if (!isBrowser()) return {};
  const parsed = safeParse<DirectoryMap>(
    window.localStorage.getItem(DIRECTORY_KEY),
  );
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

function writeDirectory(map: DirectoryMap): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(DIRECTORY_KEY, JSON.stringify(map));
}

export function findDirectoryEntry(
  key: string | undefined | null,
): DirectoryEntry | undefined {
  if (!key) return undefined;
  return getDirectory()[key];
}

/**
 * Upsert a directory entry. Dedupe rules:
 * - If an entry already exists under the new `normalizedContactKey`, we
 *   update it in place (preserving its `id` and `createdAt`).
 * - If the caller provides an `existingId` whose entry sits under a
 *   *different* key (e.g. the player changed email), we delete the old
 *   key so each person stays single-keyed.
 */
export function saveDirectoryEntry(
  input: Omit<DirectoryEntry, "id" | "createdAt" | "updatedAt"> & {
    existingId?: string;
  },
): SaveDirectoryEntryResult {
  const map = getDirectory();
  const key = input.normalizedContactKey;
  const now = nowIso();

  let prior: DirectoryEntry | undefined = map[key];

  // If the user moved from one key to another, find their old row and remove
  // it so they have a single canonical entry.
  if (!prior && input.existingId) {
    for (const [k, entry] of Object.entries(map)) {
      if (entry.id === input.existingId && k !== key) {
        prior = entry;
        delete map[k];
        break;
      }
    }
  }

  const entry: DirectoryEntry = {
    id: prior?.id ?? input.existingId ?? generateId(),
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    normalizedContactKey: key,
    country: input.country,
    preferredMethod: input.preferredMethod,
    interacEmail: input.interacEmail,
    interacPhone: input.interacPhone,
    venmoHandle: input.venmoHandle,
    cashAppTag: input.cashAppTag,
    paypalLink: input.paypalLink,
    zelleEmail: input.zelleEmail,
    zellePhone: input.zellePhone,
    notes: input.notes,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };

  map[key] = entry;
  writeDirectory(map);

  // Kick off the Supabase mirror upsert immediately so the network round
  // trip overlaps with the caller's React updates. The returned promise is
  // safe to ignore — `upsertPlayerRemote` never rejects (it converts every
  // failure mode into a structured `PlayersRemoteResult`).
  const remote = upsertPlayerRemote(entry);

  return { entry, remote };
}
