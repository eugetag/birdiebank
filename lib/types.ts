export type HoleCount = 9 | 18;
export type StartingHole = 1 | 10;

export type RoundDetails = {
  courseName: string;
  /** Optional friendly name e.g. "Sunday Skins" */
  roundName?: string;
  /** ISO date string `YYYY-MM-DD` */
  date: string;
  holes: HoleCount;
  startingHole: StartingHole;
};

export type Country = "Canada" | "United States" | "Other";

export type PaymentMethod =
  | "Interac e-Transfer"
  | "Venmo"
  | "Cash App"
  | "PayPal"
  | "Zelle"
  | "Cash"
  | "Other";

/**
 * Settlement payment profile per player. We never collect bank or card info —
 * just a preferred destination so the host can copy a friendly instruction.
 */
export type PaymentProfile = {
  country: Country;
  preferredMethod: PaymentMethod;
  /** Interac (Canada): email-based e-Transfer recipient. */
  interacEmail?: string;
  /** Interac (Canada): phone-based e-Transfer recipient. */
  interacPhone?: string;
  /** Venmo handle, with or without leading "@". */
  venmoHandle?: string;
  /** Cash App $Cashtag, with or without leading "$". */
  cashAppTag?: string;
  /** Full PayPal.me URL or paypal email. */
  paypalLink?: string;
  /** Zelle: email-based recipient. */
  zelleEmail?: string;
  /** Zelle: phone-based recipient. */
  zellePhone?: string;
  /** Free-form notes (used as primary detail when method is "Other"). */
  notes?: string;
};

export type Player = {
  id: string;
  name: string;
  /** Optional settlement details — never required to play a round. */
  paymentProfile?: PaymentProfile;
  /**
   * Stable cross-round identity, derived from email / phone / fallback id.
   * Set once the host saves the player's settlement info on the results page.
   * Used to look up directory entries and ledger debts for future rounds.
   */
  normalizedContactKey?: string;
};

/** Currency the host plans to settle the round in. */
export type Currency = "CAD" | "USD";

/**
 * Persistent cross-round player record. Stored under `gbl_player_directory`,
 * keyed by `normalizedContactKey`. Designed to migrate cleanly to Supabase later.
 */
export type DirectoryEntry = {
  id: string;
  displayName: string;
  email?: string;
  phone?: string;
  normalizedContactKey: string;
  country?: Country;
  preferredMethod?: PaymentMethod;
  interacEmail?: string;
  interacPhone?: string;
  venmoHandle?: string;
  cashAppTag?: string;
  paypalLink?: string;
  zelleEmail?: string;
  zellePhone?: string;
  notes?: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
};

export type LedgerStatus = "pending" | "paid" | "disputed" | "forgiven";

export type NotificationType = "email" | "sms";
export type NotificationStatus = "draft" | "sent";

/**
 * One outgoing settlement notification. Stored under `gbl_notifications`
 * as a flat array. The required fields match the spec exactly; the
 * remaining optional fields are denormalised at write time so the
 * Notification History view stays readable even after the underlying
 * round / directory entry mutates.
 */
export type Notification = {
  id: string;
  /** Recipient (the payer / debtor) keyed against the directory. */
  playerContactKey: string;
  roundId: string;
  type: NotificationType;
  /** Fully-rendered message body (email includes the Subject: prefix). */
  message: string;
  status: NotificationStatus;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  // -- Denormalised metadata (optional, used for richer history display) --
  recipientName?: string;
  /** Email or phone the host intended to send to. */
  recipientContact?: string;
  roundName?: string;
  courseName?: string;
  /** ISO date string `YYYY-MM-DD` of the round. */
  date?: string;
  amount?: number;
  currency?: Currency;
  receiverContactKey?: string;
  receiverName?: string;
};

/**
 * One running ledger debt between two contact keys. Stored under
 * `gbl_ledger_entries` as a flat array. Designed to migrate cleanly to Supabase later.
 */
/** How the last ledger save/sync resolved (shown on Results pills). */
export type LedgerSyncState = "cloud" | "local" | "error" | "exists";

export type LedgerEntry = {
  id: string;
  roundId: string;
  roundName?: string;
  courseName?: string;
  /** ISO date string `YYYY-MM-DD` of the round. */
  date: string;
  payerContactKey: string;
  payerName: string;
  receiverContactKey: string;
  receiverName: string;
  amount: number;
  currency: Currency;
  status: LedgerStatus;
  paymentMethod?: string;
  memo?: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Remote row uuid when mirrored to Supabase `ledger_entries`. */
  supabaseId?: string;
  /** Last known outcome of the Supabase mirror (for UI pills on Results). */
  syncState?: LedgerSyncState;
};

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

/* ---------- Bets ---------- */

export type SkinsBet = {
  enabled: boolean;
  /** Amount per skin (in dollars). */
  amount: number;
};

export type NassauBet = {
  enabled: boolean;
  front9: number;
  back9: number;
  total: number;
};

export type StraightMatchBet = {
  enabled: boolean;
  playerAId: string | null;
  playerBId: string | null;
  amount: number;
};

/** One closest-to-pin hole entry: a played hole with its own pot. */
export type ClosestToPinHole = {
  hole: number;
  amount: number;
};

export type ClosestToPinBet = {
  enabled: boolean;
  /** Each entry is a played hole with its own bet amount. Order is not meaningful. */
  holes: ClosestToPinHole[];
};

/**
 * Per-hole winner picked on the scorecard.
 * Value is a playerId, or the literal "push" for tie/no winner.
 * Holes that haven't been answered yet are simply missing from the map.
 */
export type ClosestToPinWinnersMap = Record<number, string | "push">;

export type TeamMatchMode = "total-score" | "team-skins" | "both";

export type TeamMatchBet = {
  enabled: boolean;
  teamAPlayer1Id: string | null;
  teamAPlayer2Id: string | null;
  teamBPlayer1Id: string | null;
  teamBPlayer2Id: string | null;
  mode: TeamMatchMode;
  /** Total bet amount paid by the losing team (split evenly) to the winning team. */
  totalScoreAmount: number;
  /** Per-hole skins amount; carryovers multiply the per-team total. */
  skinsAmount: number;
};

export type Bets = {
  skins: SkinsBet;
  nassau: NassauBet;
  teamMatch: TeamMatchBet;
  straightMatch: StraightMatchBet;
  closestToPin: ClosestToPinBet;
};

/** Supabase `bets.bet_type` enum values. */
export type BetType =
  | "skins"
  | "nassau"
  | "straight_match"
  | "closest_to_pin"
  | "team_match";

export const DEFAULT_BETS: Bets = {
  skins: { enabled: false, amount: 1 },
  nassau: { enabled: false, front9: 5, back9: 5, total: 10 },
  teamMatch: {
    enabled: false,
    teamAPlayer1Id: null,
    teamAPlayer2Id: null,
    teamBPlayer1Id: null,
    teamBPlayer2Id: null,
    mode: "total-score",
    totalScoreAmount: 20,
    skinsAmount: 2,
  },
  straightMatch: {
    enabled: false,
    playerAId: null,
    playerBId: null,
    amount: 10,
  },
  closestToPin: { enabled: false, holes: [] },
};

/* ---------- Scores ---------- */

/** holeNumber -> playerId -> score (null when blank). */
export type ScoresMap = Record<number, Record<string, number | null>>;

/* ---------- Results ---------- */

/**
 * One leg of the final "who pays whom" graph.
 * Amount is in dollars, rounded to two decimals.
 */
export type SettlementTransaction = {
  fromId: string;
  toId: string;
  amount: number;
};

/** Host-managed status for each pending settlement transaction. */
export type SettlementStatus = "paid" | "pending" | "disputed";

/** Keyed by `${fromId}->${toId}` so it survives recompute as long as the pair holds. */
export type SettlementStatusMap = Record<string, SettlementStatus>;

export type SkinsHoleResult =
  | {
      hole: number;
      outcome: "won";
      /** Player who won the pot for this hole. */
      winnerId: string;
      /** Number of skins they collected, including any carryover from prior holes. */
      skinsAwarded: number;
    }
  | {
      hole: number;
      outcome: "carryover";
      /** Skins carried INTO this hole (from prior ties). */
      carryIn: number;
    };

export type SkinsResult = {
  amountPerSkin: number;
  holes: SkinsHoleResult[];
  /** Skins per player won across all holes. */
  skinsByPlayer: Record<string, number>;
  /** Skins still unclaimed at end of round (last tie that never resolved). */
  unclaimedCarryover: number;
  /** Net dollars per player from skins. */
  perPlayerNet: Record<string, number>;
};

export type NassauSegmentResult = {
  amount: number;
  /** Total score per player for the segment. */
  scoresByPlayer: Record<string, number>;
  /** Winner id, or null on push. */
  winnerId: string | null;
};

export type NassauResult = {
  front9?: NassauSegmentResult;
  back9?: NassauSegmentResult;
  total?: NassauSegmentResult;
  perPlayerNet: Record<string, number>;
};

export type StraightMatchResult = {
  playerAId: string;
  playerBId: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  amount: number;
  perPlayerNet: Record<string, number>;
};

export type ClosestToPinHoleResult =
  | {
      hole: number;
      outcome: "won";
      winnerId: string;
      /** This hole's base amount (before adding any carry-in). */
      holeAmount: number;
      /** Carry-over rolled into this hole from prior pushed CTP holes. */
      carryIn: number;
      /** Amount actually awarded to the winner (holeAmount + carryIn). */
      potAwarded: number;
    }
  | {
      hole: number;
      outcome: "push";
      holeAmount: number;
      carryIn: number;
    };

export type ClosestToPinResult = {
  /** Holes in the order they were settled (sorted by hole number). */
  holes: ClosestToPinHoleResult[];
  /** Dollars left in the pot if the last CTP hole pushed. */
  unclaimedCarryover: number;
  perPlayerNet: Record<string, number>;
};

export type TeamSide = "A" | "B";

export type TeamMatchTotalScoreResult = {
  amount: number;
  teamATotal: number;
  teamBTotal: number;
  /** Winning team, or null on push. */
  winner: TeamSide | null;
};

export type TeamMatchSkinsHoleResult =
  | {
      hole: number;
      outcome: "won";
      winner: TeamSide;
      teamAScore: number;
      teamBScore: number;
      /** Skins on offer this hole (1 + any carry from prior ties). */
      skinsAwarded: number;
    }
  | {
      hole: number;
      outcome: "carryover";
      teamAScore: number;
      teamBScore: number;
      /** Skins carried INTO this hole from prior ties. */
      carryIn: number;
    };

export type TeamMatchSkinsResult = {
  amount: number;
  holes: TeamMatchSkinsHoleResult[];
  skinsByTeam: { A: number; B: number };
  unclaimedCarryover: number;
};

export type TeamMatchResult = {
  teamAPlayerIds: [string, string];
  teamBPlayerIds: [string, string];
  totalScore?: TeamMatchTotalScoreResult;
  skins?: TeamMatchSkinsResult;
  perPlayerNet: Record<string, number>;
};

export type BetResults = {
  skins?: SkinsResult;
  nassau?: NassauResult;
  teamMatch?: TeamMatchResult;
  straightMatch?: StraightMatchResult;
  closestToPin?: ClosestToPinResult;
  /** Sum of every bet's perPlayerNet, keyed by playerId. */
  perPlayerTotalNet: Record<string, number>;
  /** Minimised set of transfers to settle every debt. */
  settlement: SettlementTransaction[];
};

/* ---------- Rounds ---------- */

export type Round = {
  id: string;
  supabaseRoundId?: string;
  details: RoundDetails;
  players: Player[];
  bets: Bets;
  scores: ScoresMap;
  closestToPinWinners: ClosestToPinWinnersMap;
  results: BetResults;
  settlementStatuses: SettlementStatusMap;
  /** ISO timestamp */
  createdAt: string;
};

/** Cloud sync state for the in-progress round metadata row. */
export type RoundSyncState = "cloud" | "local";

/** A round being built across multiple setup steps. */
export type DraftRound = {
  /**
   * Stable id reserved for the eventual finalized round, assigned lazily on
   * first need (e.g. when the host adds a settlement to the ledger). The
   * same id is reused when `finalizeDraft` snapshots the round, so any
   * ledger entries created mid-draft stay linked.
   */
  id?: string;
  /** Supabase `rounds.id` when the create step synced successfully. */
  supabaseRoundId?: string;
  /** Whether round metadata was saved to Supabase or localStorage only. */
  roundSyncState?: RoundSyncState;
  /** Whether round roster was mirrored to Supabase `round_players`. */
  playersSyncState?: RoundSyncState;
  /** Whether bet setup was mirrored to Supabase `bets`. */
  betsSyncState?: RoundSyncState;
  /** Whether hole scores were mirrored to Supabase `hole_scores`. */
  scoresSyncState?: RoundSyncState;
  details?: RoundDetails;
  players?: Player[];
  bets?: Bets;
  scores?: ScoresMap;
  closestToPinWinners?: ClosestToPinWinnersMap;
  results?: BetResults;
  settlementStatuses?: SettlementStatusMap;
  /** ISO timestamp */
  updatedAt: string;
};

/** Compute the list of hole numbers actually played for a round. */
export function playedHoles(
  holes: HoleCount,
  startingHole: StartingHole,
): number[] {
  if (holes === 18) {
    return Array.from({ length: 18 }, (_, i) => i + 1);
  }
  if (startingHole === 1) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return [10, 11, 12, 13, 14, 15, 16, 17, 18];
}

/**
 * Hole numbers in the order they are actually played, accounting for
 * shotgun starts on the back nine.
 */
export function holesInPlayOrder(
  holes: HoleCount,
  startingHole: StartingHole,
): number[] {
  if (holes === 9) return playedHoles(holes, startingHole);
  if (startingHole === 1) return playedHoles(holes, startingHole);
  // 18 holes starting on hole 10 → back nine first, then front nine.
  return [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}
