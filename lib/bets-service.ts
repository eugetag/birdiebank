/**
 * Sync draft bet configuration to Supabase `bets`.
 *
 * localStorage remains the source of truth for settlement math; this only
 * mirrors the host's enabled bet types + configs when a cloud round exists.
 */

import { replaceRoundBetsRemote, type BetRowInput } from "./supabase/bets";
import { getDraftSupabaseRoundId } from "./rounds-service";
import { writeDraftBetsSync } from "./rounds";
import type {
  BetType,
  Bets,
  ClosestToPinBet,
  NassauBet,
  SkinsBet,
  StraightMatchBet,
  TeamMatchBet,
  RoundSyncState,
} from "./types";

export type BetsSyncResult = {
  outcome: RoundSyncState;
};

/**
 * Build Supabase bet rows for enabled types only. Team match requires four
 * players — same rule as the /bets UI (`teamMatchActive`).
 */
export function enabledBetsForSupabase(
  bets: Bets,
  playerCount: number,
): BetRowInput[] {
  const rows: BetRowInput[] = [];

  const push = (bet_type: BetType, config: unknown) => {
    rows.push({ bet_type, config: config as BetRowInput["config"] });
  };

  if (bets.skins.enabled) {
    push("skins", bets.skins satisfies SkinsBet);
  }
  if (bets.nassau.enabled) {
    push("nassau", bets.nassau satisfies NassauBet);
  }
  if (bets.straightMatch.enabled) {
    push("straight_match", bets.straightMatch satisfies StraightMatchBet);
  }
  if (bets.closestToPin.enabled) {
    push("closest_to_pin", bets.closestToPin satisfies ClosestToPinBet);
  }
  if (bets.teamMatch.enabled && playerCount === 4) {
    push("team_match", bets.teamMatch satisfies TeamMatchBet);
  }

  return rows;
}

/**
 * Mirror bet setup on continue from /bets. Without `supabaseRoundId`, only
 * localStorage is used and outcome is `local`.
 */
export async function syncDraftBets(
  bets: Bets,
  playerCount: number,
): Promise<BetsSyncResult> {
  const supabaseRoundId = getDraftSupabaseRoundId();
  if (!supabaseRoundId) {
    const outcome: RoundSyncState = "local";
    writeDraftBetsSync({ betsSyncState: outcome });
    return { outcome };
  }

  const rows = enabledBetsForSupabase(bets, playerCount);
  const remote = await replaceRoundBetsRemote(supabaseRoundId, rows);
  const outcome: RoundSyncState = remote.ok ? "cloud" : "local";
  writeDraftBetsSync({ betsSyncState: outcome });
  return { outcome };
}
