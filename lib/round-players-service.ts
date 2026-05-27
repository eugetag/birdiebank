/**
 * Sync the draft round roster to Supabase (`players` + `round_players`).
 *
 * localStorage draft players remain the source of truth for in-app flow;
 * this service mirrors roster membership when Supabase is configured.
 */

import { normalizeContactKey, parseContactKey } from "./directory";
import { getDraftSupabaseRoundId } from "./rounds-service";
import { writeDraftPlayersSync } from "./rounds";
import { linkPlayerToRoundRemote } from "./supabase/round-players";
import {
  upsertPlayerRemote,
  type PlayerUpsertPayload,
} from "./supabase/players";
import type { Player, RoundSyncState } from "./types";

export type RoundPlayersSyncResult = {
  outcome: RoundSyncState;
};

/** Canonical contact key for a round player (matches ledger / results). */
export function contactKeyForRoundPlayer(player: Player): string {
  return (
    player.normalizedContactKey ??
    normalizeContactKey({ fallbackId: player.id })
  );
}

/** Build a directory-shaped payload for Supabase `players` upsert. */
export function playerToDirectoryUpsert(player: Player): PlayerUpsertPayload {
  const normalizedContactKey = contactKeyForRoundPlayer(player);
  const fromKey = parseContactKey(normalizedContactKey);
  const profile = player.paymentProfile;

  return {
    displayName: player.name,
    email: fromKey.email,
    phone: fromKey.phone,
    normalizedContactKey,
    country: profile?.country,
    preferredMethod: profile?.preferredMethod,
    interacEmail: profile?.interacEmail,
    interacPhone: profile?.interacPhone,
    venmoHandle: profile?.venmoHandle,
    cashAppTag: profile?.cashAppTag,
    paypalLink: profile?.paypalLink,
    zelleEmail: profile?.zelleEmail,
    zellePhone: profile?.zellePhone,
    notes: profile?.notes,
  };
}

async function syncOneRoundPlayer(
  player: Player,
  supabaseRoundId: string | undefined,
): Promise<boolean> {
  const upsert = await upsertPlayerRemote(playerToDirectoryUpsert(player));
  if (!upsert.ok) return false;

  if (!supabaseRoundId) return true;

  const link = await linkPlayerToRoundRemote({
    roundId: supabaseRoundId,
    playerId: upsert.playerId,
    displayName: player.name,
  });
  return link.ok;
}

/**
 * Mirror one player to Supabase after they are added on `/players`.
 * Never throws; updates draft `playersSyncState` when `persistState` is true.
 */
export async function syncSingleRoundPlayer(
  player: Player,
  options?: { persistState?: boolean },
): Promise<RoundPlayersSyncResult> {
  const supabaseRoundId = getDraftSupabaseRoundId();
  const ok = await syncOneRoundPlayer(player, supabaseRoundId);
  const outcome: RoundSyncState = ok ? "cloud" : "local";
  if (options?.persistState !== false) {
    writeDraftPlayersSync({ playersSyncState: outcome });
  }
  return { outcome };
}

/**
 * Mirror the full draft roster (used when continuing to `/bets`).
 * Fails closed to `local` if any player or link step fails.
 */
export async function syncDraftRoundPlayers(
  players: Player[],
): Promise<RoundPlayersSyncResult> {
  const supabaseRoundId = getDraftSupabaseRoundId();
  if (players.length === 0) {
    const outcome: RoundSyncState = "local";
    writeDraftPlayersSync({ playersSyncState: outcome });
    return { outcome };
  }

  let allOk = true;
  for (const player of players) {
    const ok = await syncOneRoundPlayer(player, supabaseRoundId);
    if (!ok) allOk = false;
  }

  const outcome: RoundSyncState = allOk ? "cloud" : "local";
  writeDraftPlayersSync({ playersSyncState: outcome });
  return { outcome };
}
