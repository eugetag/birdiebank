/**
 * Remote (Supabase) reads/writes for `ledger_entries`.
 *
 * Mirrors the player migration pattern: never throws, dynamic-imports the
 * client so pages without env vars keep working, and returns structured
 * results the caller can turn into UI pills.
 */

import type { Currency, LedgerEntry, LedgerStatus } from "../types";
import {
  normalizeRoundIdForSupabase,
  parseSupabaseError,
  type SupabaseErrorDetails,
} from "./errors";
import type { LedgerEntryRow } from "./types";

export type { SupabaseErrorDetails };

export type LedgerRemoteResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown };

export type InsertLedgerRemoteResult =
  | { ok: true; supabaseId: string }
  | { ok: false; reason: "unconfigured"; error: unknown; errorInfo: SupabaseErrorDetails }
  | { ok: false; reason: "error"; error: unknown; errorInfo: SupabaseErrorDetails };

export function rowToLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    supabaseId: row.id,
    roundId: row.round_id ?? "",
    roundName: row.round_name ?? undefined,
    courseName: row.course_name ?? undefined,
    date: row.round_date,
    payerContactKey: row.payer_contact_key,
    payerName: row.payer_name,
    receiverContactKey: row.receiver_contact_key,
    receiverName: row.receiver_name,
    amount: row.amount,
    currency: row.currency as Currency,
    status: row.status,
    paymentMethod: row.payment_method ?? undefined,
    memo: row.memo ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: "cloud",
  };
}

export function entryToInsertPayload(
  entry: Omit<LedgerEntry, "id" | "createdAt" | "updatedAt">,
  options?: { supabaseRoundId?: string | null },
): Record<string, unknown> {
  const round_id = normalizeRoundIdForSupabase(
    options?.supabaseRoundId ?? entry.roundId,
  );
  return {
    round_id,
    round_name: entry.roundName ?? null,
    course_name: entry.courseName ?? null,
    round_date: entry.date,
    payer_contact_key: entry.payerContactKey,
    payer_name: entry.payerName,
    receiver_contact_key: entry.receiverContactKey,
    receiver_name: entry.receiverName,
    amount: entry.amount,
    currency: entry.currency,
    status: entry.status,
    payment_method: entry.paymentMethod ?? null,
    memo: entry.memo ?? null,
  };
}

/** Find an existing row matching the product duplicate key. Never throws. */
export async function findDuplicateLedgerRemote(
  candidate: Pick<
    LedgerEntry,
    | "roundName"
    | "courseName"
    | "date"
    | "payerContactKey"
    | "receiverContactKey"
    | "amount"
  >,
): Promise<LedgerEntry | null> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch {
    return null;
  }

  try {
    const { data, error } = await mod.supabase
      .from("ledger_entries")
      .select("*")
      .eq("round_date", candidate.date)
      .eq("payer_contact_key", candidate.payerContactKey)
      .eq("receiver_contact_key", candidate.receiverContactKey)
      .eq("amount", candidate.amount);

    if (error || !data) return null;
    const rows = (Array.isArray(data) ? data : []) as LedgerEntryRow[];
    const roundName = candidate.roundName ?? "";
    const courseName = candidate.courseName ?? "";
    const match = rows.find(
      (r) =>
        (r.round_name ?? "") === roundName &&
        (r.course_name ?? "") === courseName,
    );
    return match ? rowToLedgerEntry(match) : null;
  } catch {
    return null;
  }
}

/** Insert one ledger row. Returns the remote uuid on success. Never throws. */
export async function insertLedgerEntryRemote(
  entry: Omit<LedgerEntry, "id" | "createdAt" | "updatedAt" | "supabaseId" | "syncState">,
  options?: { supabaseRoundId?: string | null },
): Promise<InsertLedgerRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    return { ok: false, reason: "unconfigured", error: err, errorInfo };
  }

  const payload = entryToInsertPayload(entry, options);

  if (typeof console !== "undefined") {
    console.info("[ledger] Supabase insert payload", payload);
  }

  try {
    const { data, error } = await mod.supabase
      .from("ledger_entries")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      const errorInfo = parseSupabaseError(error);
      if (typeof console !== "undefined") {
        console.warn("[ledger] Supabase insert failed", errorInfo);
      }
      return { ok: false, reason: "error", error, errorInfo };
    }
    const id = data?.id;
    if (!id || typeof id !== "string") {
      const errorInfo: SupabaseErrorDetails = {
        message: "Insert succeeded but no id returned",
      };
      return {
        ok: false,
        reason: "error",
        error: new Error(errorInfo.message),
        errorInfo,
      };
    }
    return { ok: true, supabaseId: id };
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    if (typeof console !== "undefined") {
      console.warn("[ledger] Supabase insert threw", errorInfo);
    }
    return { ok: false, reason: "error", error: err, errorInfo };
  }
}

/**
 * Fetch pending/disputed ledger rows involving any of the given contact keys.
 * Never throws.
 */
export async function fetchUnsettledLedgerRemote(
  contactKeys: ReadonlyArray<string>,
): Promise<
  | { ok: true; entries: LedgerEntry[] }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown }
> {
  if (contactKeys.length === 0) {
    return { ok: true, entries: [] };
  }

  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  const keys = [...new Set(contactKeys.filter(Boolean))];
  if (keys.length === 0) {
    return { ok: true, entries: [] };
  }

  const orClause = keys
    .flatMap(
      (k) => [`payer_contact_key.eq.${k}`, `receiver_contact_key.eq.${k}`],
    )
    .join(",");

  try {
    const { data, error } = await mod.supabase
      .from("ledger_entries")
      .select("*")
      .in("status", ["pending", "disputed"])
      .or(orClause);

    if (error) return { ok: false, reason: "error", error };
    const rows = (Array.isArray(data) ? data : []) as LedgerEntryRow[];
    return { ok: true, entries: rows.map(rowToLedgerEntry) };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}

/** Patch status on a remote row by its Supabase uuid. Never throws. */
export async function updateLedgerStatusRemote(
  supabaseId: string,
  status: LedgerStatus,
): Promise<LedgerRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const { error } = await mod.supabase
      .from("ledger_entries")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", supabaseId);

    if (error) return { ok: false, reason: "error", error };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}
