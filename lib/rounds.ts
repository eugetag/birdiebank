import {
  DEFAULT_BETS,
  type BetResults,
  type Bets,
  type ClosestToPinBet,
  type ClosestToPinWinnersMap,
  type DraftRound,
  type Player,
  type Round,
  type RoundDetails,
  type RoundSyncState,
  type ScoresMap,
  type SettlementStatusMap,
} from "./types";

const DRAFT_KEY = "gbl:draft";
const ROUNDS_KEY = "gbl:rounds";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(): string {
  if (isBrowser() && "crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `r_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/* ---------- Draft (in-progress round setup) ---------- */

type LegacyClosestToPinBet = {
  enabled?: unknown;
  hole?: unknown;
  amount?: unknown;
  holes?: unknown;
};

type LegacyDraftRound = DraftRound & {
  closestToPinWinnerId?: string | null;
};

export function getDraft(): DraftRound | undefined {
  if (!isBrowser()) return undefined;
  const raw = safeParse<LegacyDraftRound>(
    window.localStorage.getItem(DRAFT_KEY),
  );
  if (!raw) return raw;
  // Normalise so older drafts that predate newer bet shapes still render
  // and compute cleanly.
  if (raw.bets) {
    raw.bets = normalizeBets(raw.bets);
  }
  // Migrate the old single CTP winner field to the new winners map.
  if (!raw.closestToPinWinners && raw.closestToPinWinnerId) {
    const firstHole = raw.bets?.closestToPin.holes[0]?.hole;
    if (typeof firstHole === "number") {
      raw.closestToPinWinners = { [firstHole]: raw.closestToPinWinnerId };
    }
  }
  delete raw.closestToPinWinnerId;
  return raw;
}

/**
 * Merge a (possibly partial / older) saved bets object with the latest
 * `DEFAULT_BETS` shape. Existing values win on each leaf object.
 */
export function normalizeBets(saved: Partial<Bets>): Bets {
  return {
    skins: { ...DEFAULT_BETS.skins, ...(saved.skins ?? {}) },
    nassau: { ...DEFAULT_BETS.nassau, ...(saved.nassau ?? {}) },
    teamMatch: {
      ...DEFAULT_BETS.teamMatch,
      ...(saved.teamMatch ?? {}),
    },
    straightMatch: {
      ...DEFAULT_BETS.straightMatch,
      ...(saved.straightMatch ?? {}),
    },
    closestToPin: normalizeClosestToPin(saved.closestToPin),
  };
}

/**
 * Coerce legacy CTP shapes into the new `{ enabled, holes: [...] }` shape.
 * The original MVP stored `{ enabled, hole: number | null, amount: number }`,
 * so we promote that single entry into the new array.
 */
function normalizeClosestToPin(
  saved: ClosestToPinBet | LegacyClosestToPinBet | undefined,
): ClosestToPinBet {
  if (!saved) return { ...DEFAULT_BETS.closestToPin };

  const enabled = Boolean(saved.enabled);

  if (Array.isArray(saved.holes)) {
    const holes = saved.holes
      .filter(
        (h): h is { hole: number; amount: number } =>
          !!h &&
          typeof (h as { hole?: unknown }).hole === "number" &&
          typeof (h as { amount?: unknown }).amount === "number",
      )
      .map((h) => ({ hole: h.hole, amount: h.amount }));
    return { enabled, holes };
  }

  const legacyHole = (saved as LegacyClosestToPinBet).hole;
  const legacyAmount = (saved as LegacyClosestToPinBet).amount;
  if (typeof legacyHole === "number" && typeof legacyAmount === "number") {
    return { enabled, holes: [{ hole: legacyHole, amount: legacyAmount }] };
  }

  return { enabled, holes: [] };
}

function writeDraft(next: DraftRound): DraftRound {
  if (!isBrowser()) return next;
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  return next;
}

export function setDraftDetails(details: RoundDetails): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    details,
    updatedAt: nowIso(),
  });
}

/** Stamp Supabase round id + sync state on the active draft. */
export function writeDraftRoundSync(patch: {
  supabaseRoundId?: string;
  roundSyncState?: RoundSyncState;
}): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    ...patch,
    updatedAt: nowIso(),
  });
}

/** Stamp roster mirror sync state on the active draft. */
export function writeDraftPlayersSync(patch: {
  playersSyncState?: RoundSyncState;
}): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    ...patch,
    updatedAt: nowIso(),
  });
}

/** Stamp bet setup mirror sync state on the active draft. */
export function writeDraftBetsSync(patch: {
  betsSyncState?: RoundSyncState;
}): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    ...patch,
    updatedAt: nowIso(),
  });
}

/** Stamp hole scores mirror sync state on the active draft. */
export function writeDraftScoresSync(patch: {
  scoresSyncState?: RoundSyncState;
}): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    ...patch,
    updatedAt: nowIso(),
  });
}

export function setDraftPlayers(players: Player[]): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    players,
    updatedAt: nowIso(),
  });
}

/**
 * Replace a single player in the draft in-place by id. Used by the results
 * page so saving a player's settlement info doesn't blow away other fields.
 */
export function setDraftPlayer(player: Player): DraftRound {
  const current = getDraft();
  const players = (current?.players ?? []).map((p) =>
    p.id === player.id ? player : p,
  );
  return writeDraft({
    ...current,
    players,
    updatedAt: nowIso(),
  });
}

/**
 * Return the draft's stable round id, generating + persisting one on first
 * call. We reuse this id when `finalizeDraft` runs, so any ledger entries
 * created mid-draft (e.g. when the host hits "Add to Ledger") stay linked.
 */
export function ensureDraftId(): string {
  const current = getDraft();
  if (current?.id) return current.id;
  const id = generateId();
  writeDraft({ ...current, id, updatedAt: nowIso() });
  return id;
}

export function setDraftBets(bets: Bets): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    bets,
    updatedAt: nowIso(),
  });
}

export function setDraftScores(scores: ScoresMap): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    scores,
    updatedAt: nowIso(),
  });
}

export function setDraftCtpWinners(
  winners: ClosestToPinWinnersMap,
): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    closestToPinWinners: winners,
    updatedAt: nowIso(),
  });
}

export function setDraftResults(results: BetResults): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    results,
    updatedAt: nowIso(),
  });
}

export function setDraftSettlementStatuses(
  statuses: SettlementStatusMap,
): DraftRound {
  const current = getDraft();
  return writeDraft({
    ...current,
    settlementStatuses: statuses,
    updatedAt: nowIso(),
  });
}

export function clearDraft(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(DRAFT_KEY);
}

/* ---------- Finalized rounds ---------- */

export function listRounds(): Round[] {
  if (!isBrowser()) return [];
  const parsed = safeParse<Round[]>(window.localStorage.getItem(ROUNDS_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

export function getRound(id: string): Round | undefined {
  return listRounds().find((r) => r.id === id);
}

/** Promote the current draft into a finalized round and clear the draft. */
export function finalizeDraft(): Round | undefined {
  const draft = getDraft();
  if (
    !draft?.details ||
    !draft?.players?.length ||
    !draft?.bets ||
    !draft?.scores ||
    !draft?.results
  ) {
    return undefined;
  }

  const round: Round = {
    id: draft.id ?? generateId(),
    supabaseRoundId: draft.supabaseRoundId,
    details: draft.details,
    players: draft.players,
    bets: draft.bets,
    scores: draft.scores,
    closestToPinWinners: draft.closestToPinWinners ?? {},
    results: draft.results,
    settlementStatuses: draft.settlementStatuses ?? {},
    createdAt: nowIso(),
  };

  if (isBrowser()) {
    const all = listRounds();
    all.unshift(round);
    window.localStorage.setItem(ROUNDS_KEY, JSON.stringify(all));
    clearDraft();
  }

  return round;
}
