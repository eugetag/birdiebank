/**
 * Remote (Supabase) writes for `hole_scores`.
 *
 * Replaces all score rows for a round on each save (delete then insert).
 */

export type HoleScoreRowInput = {
  player_id: string;
  hole_number: number;
  score: number;
};

export type HoleScoresRemoteResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown };

/**
 * Delete existing hole scores for `roundId`, then insert the provided rows.
 * Never throws.
 */
export async function replaceRoundHoleScoresRemote(
  roundId: string,
  rows: ReadonlyArray<HoleScoreRowInput>,
): Promise<HoleScoresRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const { error: deleteError } = await mod.supabase
      .from("hole_scores")
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
      player_id: row.player_id,
      hole_number: row.hole_number,
      score: row.score,
    }));

    const { error: insertError } = await mod.supabase
      .from("hole_scores")
      .insert(payload);

    if (insertError) {
      return { ok: false, reason: "error", error: insertError };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}
