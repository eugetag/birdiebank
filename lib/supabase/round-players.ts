/**
 * Remote (Supabase) writes for `round_players`.
 *
 * Links a canonical `players` row to a `rounds` row. Duplicate
 * `(round_id, player_id)` pairs are skipped without error.
 */

export type RoundPlayersRemoteResult =
  | { ok: true; linked: boolean }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown };

export type LinkRoundPlayerInput = {
  roundId: string;
  playerId: string;
  displayName: string;
};

/**
 * Ensure one player is on a round roster. Idempotent — existing links are
 * left unchanged (display_name is not updated on duplicate).
 */
export async function linkPlayerToRoundRemote(
  input: LinkRoundPlayerInput,
): Promise<RoundPlayersRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const { data: existing, error: selectError } = await mod.supabase
      .from("round_players")
      .select("id")
      .eq("round_id", input.roundId)
      .eq("player_id", input.playerId)
      .maybeSingle();

    if (selectError) {
      return { ok: false, reason: "error", error: selectError };
    }
    if (existing) {
      return { ok: true, linked: false };
    }

    const { error: insertError } = await mod.supabase
      .from("round_players")
      .insert({
        round_id: input.roundId,
        player_id: input.playerId,
        display_name: input.displayName,
      });

    if (insertError) {
      return { ok: false, reason: "error", error: insertError };
    }
    return { ok: true, linked: true };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}
