/**
 * Deterministic mock scorecard extraction for UI testing (no OpenAI).
 */

import type { Player, ScoresMap } from "./types";

/** Stable demo scores in [3, 7] per hole and player — not AI-generated. */
export function generateDemoExtractedScores(
  holes: number[],
  players: Player[],
): ScoresMap {
  const out: ScoresMap = {};
  for (const hole of holes) {
    const row: Record<string, number | null> = {};
    players.forEach((p, playerIndex) => {
      row[p.id] = 3 + ((hole + playerIndex * 2) % 5);
    });
    out[hole] = row;
  }
  return out;
}

export const DEMO_SCORECARD_NOTE =
  "Demo mode — not AI generated. Sample scores for your current players.";
