/**
 * Round service — Supabase metadata + localStorage draft cache.
 *
 * On /create-round submit we always write localStorage first, then mirror
 * round metadata to Supabase when configured.
 */

import { ensureDraftId, getDraft, setDraftDetails, writeDraftRoundSync } from "./rounds";
import { insertRoundRemote } from "./supabase/rounds";
import type { RoundDetails, RoundSyncState } from "./types";

export type SaveRoundDetailsOutcome = RoundSyncState;

export type SaveRoundDetailsResult = {
  outcome: SaveRoundDetailsOutcome;
  supabaseRoundId?: string;
};

/**
 * Persist round details to the draft (localStorage) and insert into Supabase
 * when not already linked. Re-submitting with an existing `supabaseRoundId`
 * only updates local details — we do not create duplicate cloud rows.
 */
export async function saveRoundDetailsOnCreate(
  details: RoundDetails,
): Promise<SaveRoundDetailsResult> {
  ensureDraftId();
  setDraftDetails(details);

  const existing = getDraft()?.supabaseRoundId;
  if (existing) {
    writeDraftRoundSync({ supabaseRoundId: existing, roundSyncState: "cloud" });
    return { outcome: "cloud", supabaseRoundId: existing };
  }

  const remote = await insertRoundRemote(details);
  if (remote.ok) {
    writeDraftRoundSync({
      supabaseRoundId: remote.supabaseRoundId,
      roundSyncState: "cloud",
    });
    return {
      outcome: "cloud",
      supabaseRoundId: remote.supabaseRoundId,
    };
  }

  writeDraftRoundSync({ roundSyncState: "local" });
  return { outcome: "local" };
}

/** Supabase round uuid for the active draft, if any. */
export function getDraftSupabaseRoundId(): string | undefined {
  return getDraft()?.supabaseRoundId;
}
