/**
 * Sync draft hole scores to Supabase `hole_scores`.
 *
 * localStorage `ScoresMap` (keyed by local player ids) remains the source of
 * truth for settlement; this mirrors numeric scores when a cloud round exists.
 */

import {
  contactKeyForRoundPlayer,
  playerToDirectoryUpsert,
} from "./round-players-service";
import { getDraftSupabaseRoundId } from "./rounds-service";
import { writeDraftScoresSync } from "./rounds";
import {
  replaceRoundHoleScoresRemote,
  type HoleScoreRowInput,
} from "./supabase/hole-scores";
import { upsertPlayerRemote } from "./supabase/players";
import type { Player, RoundSyncState, ScoresMap } from "./types";

export type ScoresSyncResult = {
  outcome: RoundSyncState;
};

/**
 * Flatten `ScoresMap` into Supabase rows using resolved Supabase player ids.
 */
export function scoresMapToHoleScoreRows(
  scores: ScoresMap,
  localPlayerIdToSupabaseId: ReadonlyMap<string, string>,
): HoleScoreRowInput[] {
  const rows: HoleScoreRowInput[] = [];

  for (const [holeKey, holeRow] of Object.entries(scores)) {
    const hole_number = Number(holeKey);
    if (!Number.isFinite(hole_number)) continue;

    for (const [localPlayerId, value] of Object.entries(holeRow)) {
      if (typeof value !== "number") continue;
      const player_id = localPlayerIdToSupabaseId.get(localPlayerId);
      if (!player_id) continue;
      rows.push({
        player_id,
        hole_number,
        score: value,
      });
    }
  }

  return rows;
}

/** Upsert each round player and return local id → Supabase uuid map. */
export async function resolveSupabasePlayerIds(
  players: Player[],
): Promise<Map<string, string> | null> {
  const map = new Map<string, string>();

  for (const player of players) {
    const upsert = await upsertPlayerRemote(playerToDirectoryUpsert(player));
    if (!upsert.ok) return null;
    map.set(player.id, upsert.playerId);
    // Stable lookup if callers ever key by contact key.
    map.set(contactKeyForRoundPlayer(player), upsert.playerId);
  }

  return map;
}

/**
 * Mirror the scorecard on continue to /results. Without `supabaseRoundId`,
 * only localStorage is used and outcome is `local`.
 */
export async function syncDraftScores(
  scores: ScoresMap,
  players: Player[],
): Promise<ScoresSyncResult> {
  const supabaseRoundId = getDraftSupabaseRoundId();
  if (!supabaseRoundId) {
    const outcome: RoundSyncState = "local";
    writeDraftScoresSync({ scoresSyncState: outcome });
    return { outcome };
  }

  const playerIds = await resolveSupabasePlayerIds(players);
  if (!playerIds) {
    const outcome: RoundSyncState = "local";
    writeDraftScoresSync({ scoresSyncState: outcome });
    return { outcome };
  }

  const rows = scoresMapToHoleScoreRows(scores, playerIds);
  const remote = await replaceRoundHoleScoresRemote(supabaseRoundId, rows);
  const outcome: RoundSyncState = remote.ok ? "cloud" : "local";
  writeDraftScoresSync({ scoresSyncState: outcome });
  return { outcome };
}
