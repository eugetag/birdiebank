/**
 * Types and helpers for AI scorecard extraction (OpenAI Vision).
 */

import type { Player, ScoresMap } from "./types";

export type ScorecardConfidence = "high" | "medium" | "low";

export type ScorecardAnalysisPlayer = {
  name: string;
  scores: Record<string, number | null>;
};

export type ScorecardAnalysisResult = {
  players: ScorecardAnalysisPlayer[];
  confidence: ScorecardConfidence;
  notes: string[];
};

export type ScorecardExtraction = {
  scores: ScoresMap;
  confidence: ScorecardConfidence;
  notes: string[];
};

/** API success payload (includes debug fields from route). */
export type ScorecardAnalyzeSuccess = ScorecardAnalysisResult & {
  success: true;
  rawResponse: string;
  debug: true;
};

/** API failure payload — errors are not hidden from the client. */
export type ScorecardAnalyzeFailure = {
  success: false;
  error: string;
  rawResponse: string | null;
  debug: true;
  /** Parsed JSON when the model returned text but shape validation failed. */
  parsedJson?: unknown;
};

export type ScorecardAnalyzeApiResponse =
  | ScorecardAnalyzeSuccess
  | ScorecardAnalyzeFailure;

export type OcrDebugState = {
  imageDataUrl: string;
  error: string | null;
  rawResponse: string | null;
  rawJson: unknown;
  confidence: ScorecardConfidence | null;
  notes: string[];
  extractedPlayerNames: string[];
  aiResponseSummary: string | null;
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findPlayerByExtractedName(
  extractedName: string,
  players: Player[],
  usedIds: Set<string>,
): Player | undefined {
  const target = normalizeName(extractedName);
  if (!target) return undefined;

  const exact = players.filter(
    (p) => !usedIds.has(p.id) && normalizeName(p.name) === target,
  );
  if (exact.length === 1) return exact[0];

  const partial = players.filter((p) => {
    if (usedIds.has(p.id)) return false;
    const n = normalizeName(p.name);
    return n.includes(target) || target.includes(n);
  });
  if (partial.length === 1) return partial[0];

  return undefined;
}

/** Map vision JSON (player names + hole keys) onto draft player ids. */
export function analysisToScoresMap(
  analysis: ScorecardAnalysisResult,
  holes: number[],
  players: Player[],
): ScoresMap {
  const out: ScoresMap = {};
  const usedIds = new Set<string>();

  for (const hole of holes) {
    out[hole] = {};
    for (const p of players) {
      out[hole]![p.id] = null;
    }
  }

  for (const row of analysis.players) {
    const player = findPlayerByExtractedName(row.name, players, usedIds);
    if (!player) continue;
    usedIds.add(player.id);

    for (const hole of holes) {
      const key = String(hole);
      const raw = row.scores[key] ?? row.scores[hole];
      if (raw === null || raw === undefined) continue;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n >= 1 && n <= 15) {
        out[hole]![player.id] = Math.round(n);
      }
    }
  }

  return out;
}

export function isScorecardConfidence(
  value: unknown,
): value is ScorecardConfidence {
  return value === "high" || value === "medium" || value === "low";
}

export function parseScorecardAnalysisJson(
  raw: unknown,
): ScorecardAnalysisResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (!isScorecardConfidence(obj.confidence)) return null;
  if (!Array.isArray(obj.players)) return null;

  const players: ScorecardAnalysisPlayer[] = [];
  for (const item of obj.players) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    if (!row.scores || typeof row.scores !== "object" || Array.isArray(row.scores)) {
      continue;
    }
    const scores: Record<string, number | null> = {};
    for (const [holeKey, val] of Object.entries(
      row.scores as Record<string, unknown>,
    )) {
      if (val === null) {
        scores[holeKey] = null;
        continue;
      }
      const n = typeof val === "number" ? val : Number(val);
      scores[holeKey] = Number.isFinite(n) ? n : null;
    }
    players.push({ name: row.name.trim(), scores });
  }

  if (players.length === 0) return null;

  const notes: string[] = Array.isArray(obj.notes)
    ? obj.notes.filter((n): n is string => typeof n === "string" && n.trim() !== "")
    : [];

  return {
    players,
    confidence: obj.confidence,
    notes,
  };
}

export function extractedPlayerNames(
  analysis: ScorecardAnalysisResult | null,
  parsedJson: unknown,
): string[] {
  if (analysis?.players.length) {
    return analysis.players.map((p) => p.name);
  }
  if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
    const players = (parsedJson as { players?: unknown }).players;
    if (Array.isArray(players)) {
      return players
        .map((p) =>
          p && typeof p === "object" && !Array.isArray(p) && typeof (p as { name?: unknown }).name === "string"
            ? (p as { name: string }).name
            : null,
        )
        .filter((n): n is string => !!n);
    }
  }
  return [];
}
