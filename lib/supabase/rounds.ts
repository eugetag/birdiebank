/**
 * Remote (Supabase) writes for the `rounds` table.
 *
 * Step 1 of the rounds migration: persist round metadata on /create-round.
 * Scores and bet configuration remain localStorage-only for now.
 */

import type { RoundDetails } from "../types";
import { parseSupabaseError, type SupabaseErrorDetails } from "./errors";

export type { SupabaseErrorDetails };

export type InsertRoundRemoteResult =
  | { ok: true; supabaseRoundId: string }
  | {
      ok: false;
      reason: "unconfigured";
      error: unknown;
      errorInfo: SupabaseErrorDetails;
    }
  | { ok: false; reason: "error"; error: unknown; errorInfo: SupabaseErrorDetails };

export function detailsToRoundInsertPayload(
  details: RoundDetails,
): Record<string, unknown> {
  return {
    course_name: details.courseName,
    round_name: details.roundName ?? null,
    round_date: details.date,
    holes: details.holes,
    starting_hole: details.startingHole,
  };
}

/** Insert one round metadata row. Returns the remote uuid on success. Never throws. */
export async function insertRoundRemote(
  details: RoundDetails,
): Promise<InsertRoundRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    return { ok: false, reason: "unconfigured", error: err, errorInfo };
  }

  const payload = detailsToRoundInsertPayload(details);

  try {
    const { data, error } = await mod.supabase
      .from("rounds")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      const errorInfo = parseSupabaseError(error);
      if (typeof console !== "undefined") {
        console.warn("[rounds] Supabase insert failed", errorInfo);
      }
      return {
        ok: false,
        reason: "error",
        error,
        errorInfo,
      };
    }

    const id =
      data && typeof data === "object" && "id" in data
        ? String((data as { id: string }).id)
        : "";
    if (!id) {
      const errorInfo = parseSupabaseError(
        new Error("Insert succeeded but no id was returned."),
      );
      return {
        ok: false,
        reason: "error",
        error: new Error(errorInfo.message),
        errorInfo,
      };
    }

    return { ok: true, supabaseRoundId: id };
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    if (typeof console !== "undefined") {
      console.warn("[rounds] Supabase insert threw", errorInfo);
    }
    return { ok: false, reason: "error", error: err, errorInfo };
  }
}
