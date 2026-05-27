/**
 * Remote (Supabase) writes for the `players` table.
 *
 * This is the first slice of the Supabase migration: when settlement info
 * is saved on the Results page, we also upsert the player into Supabase so
 * that future devices / sessions converge on a single canonical row.
 *
 * Rules of engagement:
 * - localStorage remains the source of truth for now — `saveDirectoryEntry`
 *   writes locally first and only then mirrors to Supabase.
 * - Failures (missing env vars, RLS, table not yet created, network) never
 *   throw to the caller. We resolve with a structured `PlayersRemoteResult`
 *   so the caller can log/diagnose without ever surfacing a UI error.
 * - The supabase client module is **dynamic-imported** here. That keeps the
 *   throw-on-missing-env-vars contract from `lib/supabase/client.ts` from
 *   crashing `lib/directory.ts` (which is imported by every page) when the
 *   project is run without `NEXT_PUBLIC_SUPABASE_*` set.
 * - Match is by `normalized_contact_key`. The local `id` is intentionally
 *   NOT sent — the database column has its own uuid default and we never
 *   want a second device's local id to overwrite the first's row id.
 */

import type { DirectoryEntry } from "../types";

export type PlayerUpsertPayload = Omit<
  DirectoryEntry,
  "id" | "createdAt" | "updatedAt"
>;

export type PlayersRemoteResult =
  | { ok: true; playerId: string }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown };

/** Upsert one directory entry into Supabase `players`. Never throws. */
export async function upsertPlayerRemote(
  entry: PlayerUpsertPayload | DirectoryEntry,
): Promise<PlayersRemoteResult> {
  // Track the imported module type via `typeof import` so we never have
  // to guess the Database generic — keeps the typing in sync with whatever
  // `lib/supabase/client.ts` chooses to export.
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    // Most common cause: NEXT_PUBLIC_SUPABASE_* not set. Treat as
    // "no remote available" rather than a real error.
    return { ok: false, reason: "unconfigured", error: err };
  }
  const supabase = mod.supabase;

  try {
    const payload = {
      display_name: entry.displayName,
      email: entry.email ?? null,
      phone: entry.phone ?? null,
      normalized_contact_key: entry.normalizedContactKey,
      country: entry.country ?? null,
      preferred_method: entry.preferredMethod ?? null,
      interac_email: entry.interacEmail ?? null,
      interac_phone: entry.interacPhone ?? null,
      venmo_handle: entry.venmoHandle ?? null,
      cash_app_tag: entry.cashAppTag ?? null,
      paypal_link: entry.paypalLink ?? null,
      zelle_email: entry.zelleEmail ?? null,
      zelle_phone: entry.zellePhone ?? null,
      notes: entry.notes ?? null,
    };

    const { data, error } = await supabase
      .from("players")
      .upsert(payload, { onConflict: "normalized_contact_key" })
      .select("id")
      .single();

    if (error) return { ok: false, reason: "error", error };
    const playerId =
      data && typeof data === "object" && "id" in data
        ? String((data as { id: string }).id)
        : "";
    if (!playerId) {
      return {
        ok: false,
        reason: "error",
        error: new Error("Upsert succeeded but no player id was returned."),
      };
    }
    return { ok: true, playerId };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}
