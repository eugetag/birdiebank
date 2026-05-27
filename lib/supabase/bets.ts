/**
 * Remote (Supabase) writes for the `bets` table.
 *
 * Replaces all bet rows for a round on each save (delete then insert) so
 * the cloud roster always matches the host's current /bets selection.
 */

import type { BetType } from "../types";
import type { Json } from "./types";

export type BetRowInput = {
  bet_type: BetType;
  config: Json;
};

export type BetsRemoteResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown };

/**
 * Delete existing bets for `roundId`, then insert the provided rows.
 * Never throws.
 */
export async function replaceRoundBetsRemote(
  roundId: string,
  rows: ReadonlyArray<BetRowInput>,
): Promise<BetsRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const { error: deleteError } = await mod.supabase
      .from("bets")
      .delete()
      .eq("round_id", roundId);

    if (deleteError) {
      return { ok: false, reason: "error", error: deleteError };
    }

    if (rows.length === 0) {
      return { ok: true };
    }

    const payload = rows.map((row) => ({
      round_id: roundId,
      bet_type: row.bet_type,
      config: row.config,
    }));

    const { error: insertError } = await mod.supabase
      .from("bets")
      .insert(payload);

    if (insertError) {
      return { ok: false, reason: "error", error: insertError };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}
