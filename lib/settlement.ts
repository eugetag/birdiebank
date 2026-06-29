/**
 * Pure settlement math for TeeTabs.
 *
 * No React, no localStorage — given a fully-scored round, return a
 * deterministic `BetResults` summary the UI can render and persist.
 *
 * Convention used throughout:
 *  - For each "bet event" (a skin, a Nassau segment, a CTP, a match),
 *    each losing player pays the configured `amount` to the winner.
 *  - For Skins this is multiplied by the number of skins on offer (carryovers).
 *  - Straight Match has exactly one loser (the head-to-head opponent).
 *
 * All money values are kept in dollars and rounded to cents at the
 * boundaries (per-bet net and final settlement transfers).
 */

import {
  holesInPlayOrder,
  type BetResults,
  type Bets,
  type ClosestToPinHoleResult,
  type ClosestToPinResult,
  type ClosestToPinWinnersMap,
  type NassauResult,
  type NassauSegmentResult,
  type Player,
  type RoundDetails,
  type ScoresMap,
  type SettlementTransaction,
  type SkinsHoleResult,
  type SkinsResult,
  type StraightMatchResult,
  type TeamMatchResult,
  type TeamMatchSkinsHoleResult,
} from "./types";

const EPSILON = 0.005;

/** Round to whole cents, avoiding `-0`. */
function roundCents(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function emptyNet(players: Player[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of players) out[p.id] = 0;
  return out;
}

function addNet(
  target: Record<string, number>,
  src: Record<string, number>,
): void {
  for (const id of Object.keys(src)) {
    target[id] = (target[id] ?? 0) + (src[id] ?? 0);
  }
}

/* ---------- Skins ---------- */

export function computeSkins(
  holes: number[],
  players: Player[],
  scores: ScoresMap,
  amountPerSkin: number,
): SkinsResult {
  const breakdown: SkinsHoleResult[] = [];
  const perPlayerNet = emptyNet(players);
  const skinsByPlayer = emptyNet(players);

  let carry = 0; // skins waiting to be claimed

  for (const hole of holes) {
    const row = scores[hole] ?? {};
    const scored = players
      .map((p) => ({ id: p.id, score: row[p.id] }))
      .filter(
        (s): s is { id: string; score: number } => typeof s.score === "number",
      );

    if (scored.length !== players.length) {
      // Defensive: scorecard validation should have caught this.
      breakdown.push({ hole, outcome: "carryover", carryIn: carry });
      carry += 1;
      continue;
    }

    const min = Math.min(...scored.map((s) => s.score));
    const winners = scored.filter((s) => s.score === min);

    if (winners.length === 1) {
      const winner = winners[0];
      const skinsAwarded = carry + 1;
      const losers = players.filter((p) => p.id !== winner.id);
      const perLoser = amountPerSkin * skinsAwarded;
      for (const l of losers) perPlayerNet[l.id] -= perLoser;
      perPlayerNet[winner.id] += perLoser * losers.length;
      skinsByPlayer[winner.id] += skinsAwarded;
      breakdown.push({
        hole,
        outcome: "won",
        winnerId: winner.id,
        skinsAwarded,
      });
      carry = 0;
    } else {
      breakdown.push({ hole, outcome: "carryover", carryIn: carry });
      carry += 1;
    }
  }

  return {
    amountPerSkin,
    holes: breakdown,
    skinsByPlayer,
    unclaimedCarryover: carry,
    perPlayerNet: roundNetMap(perPlayerNet),
  };
}

/* ---------- Nassau ---------- */

function totalForHoles(
  holeNumbers: number[],
  playedHoles: number[],
  players: Player[],
  scores: ScoresMap,
): Record<string, number> | null {
  // Only compute if every requested hole is actually played and scored.
  for (const h of holeNumbers) {
    if (!playedHoles.includes(h)) return null;
    for (const p of players) {
      const s = scores[h]?.[p.id];
      if (typeof s !== "number") return null;
    }
  }
  const totals: Record<string, number> = {};
  for (const p of players) {
    let sum = 0;
    for (const h of holeNumbers) sum += scores[h]?.[p.id] as number;
    totals[p.id] = sum;
  }
  return totals;
}

function settleSegment(
  totals: Record<string, number>,
  players: Player[],
  amount: number,
): { result: NassauSegmentResult; net: Record<string, number> } {
  const net = emptyNet(players);

  let winnerId: string | null = null;
  if (amount > 0) {
    const min = Math.min(...players.map((p) => totals[p.id]));
    const winners = players.filter((p) => totals[p.id] === min);
    if (winners.length === 1) {
      winnerId = winners[0].id;
      const losers = players.filter((p) => p.id !== winnerId);
      for (const l of losers) net[l.id] -= amount;
      net[winnerId] += amount * losers.length;
    } else {
      winnerId = null; // push
    }
  } else {
    // Amount is zero; still report a segment winner for the breakdown but
    // no money moves.
    const min = Math.min(...players.map((p) => totals[p.id]));
    const winners = players.filter((p) => totals[p.id] === min);
    winnerId = winners.length === 1 ? winners[0].id : null;
  }

  return {
    result: {
      amount,
      scoresByPlayer: totals,
      winnerId,
    },
    net,
  };
}

export function computeNassau(
  details: RoundDetails,
  players: Player[],
  scores: ScoresMap,
  bet: Bets["nassau"],
): NassauResult {
  const playedAll = holesInPlayOrder(details.holes, details.startingHole);

  const front9Holes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const back9Holes = [10, 11, 12, 13, 14, 15, 16, 17, 18];

  const frontTotals = totalForHoles(front9Holes, playedAll, players, scores);
  const backTotals = totalForHoles(back9Holes, playedAll, players, scores);

  const out: NassauResult = { perPlayerNet: emptyNet(players) };

  if (frontTotals && bet.front9 >= 0) {
    const seg = settleSegment(frontTotals, players, bet.front9);
    out.front9 = seg.result;
    addNet(out.perPlayerNet, seg.net);
  }
  if (backTotals && bet.back9 >= 0) {
    const seg = settleSegment(backTotals, players, bet.back9);
    out.back9 = seg.result;
    addNet(out.perPlayerNet, seg.net);
  }

  // Total only makes sense for full 18-hole rounds — otherwise it would
  // duplicate the single played segment and inflate the bill.
  const isFull18 = !!frontTotals && !!backTotals;
  if (isFull18 && bet.total >= 0) {
    const totals: Record<string, number> = {};
    for (const p of players) {
      totals[p.id] =
        (frontTotals![p.id] as number) + (backTotals![p.id] as number);
    }
    const seg = settleSegment(totals, players, bet.total);
    out.total = seg.result;
    addNet(out.perPlayerNet, seg.net);
  }

  out.perPlayerNet = roundNetMap(out.perPlayerNet);
  return out;
}

/* ---------- Straight Match ---------- */

export function computeStraightMatch(
  players: Player[],
  scores: ScoresMap,
  bet: Bets["straightMatch"],
  playedHoles: number[],
): StraightMatchResult | undefined {
  if (!bet.playerAId || !bet.playerBId || bet.playerAId === bet.playerBId) {
    return undefined;
  }
  const ids = new Set(players.map((p) => p.id));
  if (!ids.has(bet.playerAId) || !ids.has(bet.playerBId)) return undefined;

  const totalFor = (id: string): number | null => {
    let total = 0;
    for (const h of playedHoles) {
      const s = scores[h]?.[id];
      if (typeof s !== "number") return null;
      total += s;
    }
    return total;
  };

  const scoreA = totalFor(bet.playerAId);
  const scoreB = totalFor(bet.playerBId);
  if (scoreA == null || scoreB == null) return undefined;

  const net = emptyNet(players);
  let winnerId: string | null = null;
  if (scoreA < scoreB) {
    winnerId = bet.playerAId;
    net[bet.playerAId] += bet.amount;
    net[bet.playerBId] -= bet.amount;
  } else if (scoreB < scoreA) {
    winnerId = bet.playerBId;
    net[bet.playerBId] += bet.amount;
    net[bet.playerAId] -= bet.amount;
  }

  return {
    playerAId: bet.playerAId,
    playerBId: bet.playerBId,
    scoreA,
    scoreB,
    winnerId,
    amount: bet.amount,
    perPlayerNet: roundNetMap(net),
  };
}

/* ---------- 2v2 Team Match ---------- */

/**
 * Returns undefined when team match cannot be computed (wrong player count,
 * missing/duplicate selections, missing scores). Otherwise produces a full
 * TeamMatchResult covering Total Score, Team Skins, or both.
 */
export function computeTeamMatch(
  players: Player[],
  bet: Bets["teamMatch"],
  scores: ScoresMap,
  holes: number[],
): TeamMatchResult | undefined {
  if (players.length !== 4) return undefined;

  const ids = [
    bet.teamAPlayer1Id,
    bet.teamAPlayer2Id,
    bet.teamBPlayer1Id,
    bet.teamBPlayer2Id,
  ];
  if (ids.some((id) => !id)) return undefined;
  const filled = ids as string[];
  if (new Set(filled).size !== 4) return undefined;
  const validIds = new Set(players.map((p) => p.id));
  if (!filled.every((id) => validIds.has(id))) return undefined;

  const [a1, a2, b1, b2] = filled;

  const scoreFor = (id: string, hole: number): number | null => {
    const s = scores[hole]?.[id];
    return typeof s === "number" ? s : null;
  };

  // Bail out if any required score is missing. The scorecard step enforces
  // completeness before we ever land on /results, but defense in depth.
  for (const hole of holes) {
    for (const id of filled) {
      if (scoreFor(id, hole) === null) return undefined;
    }
  }

  const perPlayerNet = emptyNet(players);

  const result: TeamMatchResult = {
    teamAPlayerIds: [a1, a2],
    teamBPlayerIds: [b1, b2],
    perPlayerNet,
  };

  // ---- Total Score ----
  if (
    (bet.mode === "total-score" || bet.mode === "both") &&
    bet.totalScoreAmount > 0
  ) {
    let teamATotal = 0;
    let teamBTotal = 0;
    for (const hole of holes) {
      teamATotal += (scoreFor(a1, hole) as number) + (scoreFor(a2, hole) as number);
      teamBTotal += (scoreFor(b1, hole) as number) + (scoreFor(b2, hole) as number);
    }

    let winner: "A" | "B" | null = null;
    if (teamATotal < teamBTotal) winner = "A";
    else if (teamBTotal < teamATotal) winner = "B";

    if (winner) {
      const perPlayer = bet.totalScoreAmount / 2;
      const winners = winner === "A" ? [a1, a2] : [b1, b2];
      const losers = winner === "A" ? [b1, b2] : [a1, a2];
      for (const w of winners) perPlayerNet[w] += perPlayer;
      for (const l of losers) perPlayerNet[l] -= perPlayer;
    }

    result.totalScore = {
      amount: bet.totalScoreAmount,
      teamATotal,
      teamBTotal,
      winner,
    };
  }

  // ---- Team Skins ----
  if (
    (bet.mode === "team-skins" || bet.mode === "both") &&
    bet.skinsAmount > 0
  ) {
    const breakdown: TeamMatchSkinsHoleResult[] = [];
    const skinsByTeam = { A: 0, B: 0 };
    let carry = 0;

    for (const hole of holes) {
      const aSum =
        (scoreFor(a1, hole) as number) + (scoreFor(a2, hole) as number);
      const bSum =
        (scoreFor(b1, hole) as number) + (scoreFor(b2, hole) as number);

      if (aSum === bSum) {
        breakdown.push({
          hole,
          outcome: "carryover",
          teamAScore: aSum,
          teamBScore: bSum,
          carryIn: carry,
        });
        carry += 1;
        continue;
      }

      const winner: "A" | "B" = aSum < bSum ? "A" : "B";
      const skinsAwarded = carry + 1;
      const perPlayer = (bet.skinsAmount * skinsAwarded) / 2;
      const winners = winner === "A" ? [a1, a2] : [b1, b2];
      const losers = winner === "A" ? [b1, b2] : [a1, a2];
      for (const w of winners) perPlayerNet[w] += perPlayer;
      for (const l of losers) perPlayerNet[l] -= perPlayer;
      skinsByTeam[winner] += skinsAwarded;

      breakdown.push({
        hole,
        outcome: "won",
        winner,
        teamAScore: aSum,
        teamBScore: bSum,
        skinsAwarded,
      });
      carry = 0;
    }

    result.skins = {
      amount: bet.skinsAmount,
      holes: breakdown,
      skinsByTeam,
      unclaimedCarryover: carry,
    };
  }

  result.perPlayerNet = roundNetMap(perPlayerNet);
  return result;
}

/* ---------- Closest to Pin ---------- */

/**
 * Walks the configured CTP holes in hole-number order, tracking a carry-over
 * pot for every push/tie. On a player win the available pot (hole amount +
 * any accumulated carry) is taken from each non-winning player evenly. A
 * residual carry that never resolves is reported as `unclaimedCarryover`.
 */
export function computeClosestToPin(
  players: Player[],
  bet: Bets["closestToPin"],
  winners: ClosestToPinWinnersMap,
): ClosestToPinResult | undefined {
  if (!bet.enabled || bet.holes.length === 0) return undefined;
  if (players.length < 2) return undefined;

  const sorted = [...bet.holes].sort((a, b) => a.hole - b.hole);
  const perPlayerNet = emptyNet(players);
  const breakdown: ClosestToPinHoleResult[] = [];
  const validIds = new Set(players.map((p) => p.id));

  let carry = 0;

  for (const item of sorted) {
    const winner = winners[item.hole];
    const isPlayerWinner =
      typeof winner === "string" && winner !== "push" && validIds.has(winner);

    if (isPlayerWinner) {
      const winnerId = winner;
      const pot = item.amount + carry;
      const losers = players.filter((p) => p.id !== winnerId);
      if (losers.length > 0) {
        const perLoser = pot / losers.length;
        for (const l of losers) perPlayerNet[l.id] -= perLoser;
        perPlayerNet[winnerId] += perLoser * losers.length;
      }
      breakdown.push({
        hole: item.hole,
        outcome: "won",
        winnerId,
        holeAmount: item.amount,
        carryIn: carry,
        potAwarded: pot,
      });
      carry = 0;
    } else {
      breakdown.push({
        hole: item.hole,
        outcome: "push",
        holeAmount: item.amount,
        carryIn: carry,
      });
      carry += item.amount;
    }
  }

  return {
    holes: breakdown,
    unclaimedCarryover: roundCents(carry),
    perPlayerNet: roundNetMap(perPlayerNet),
  };
}

/* ---------- Settlement graph ---------- */

/**
 * Greedy minimum-cash-flow: largest debtor pays largest creditor until
 * everyone is square. Produces at most N-1 transfers for N players.
 */
export function computeSettlement(
  perPlayerTotalNet: Record<string, number>,
): SettlementTransaction[] {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  for (const [id, raw] of Object.entries(perPlayerTotalNet)) {
    const amt = roundCents(raw);
    if (amt < -EPSILON) debtors.push({ id, amount: amt });
    else if (amt > EPSILON) creditors.push({ id, amount: amt });
  }

  debtors.sort((a, b) => a.amount - b.amount); // most negative first
  creditors.sort((a, b) => b.amount - a.amount); // largest credit first

  const out: SettlementTransaction[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const transfer = Math.min(-d.amount, c.amount);
    if (transfer > EPSILON) {
      out.push({
        fromId: d.id,
        toId: c.id,
        amount: roundCents(transfer),
      });
    }
    d.amount += transfer;
    c.amount -= transfer;
    if (Math.abs(d.amount) < EPSILON) i += 1;
    if (Math.abs(c.amount) < EPSILON) j += 1;
  }

  return out;
}

/* ---------- Top-level orchestrator ---------- */

export function computeBetResults(args: {
  details: RoundDetails;
  players: Player[];
  bets: Bets;
  scores: ScoresMap;
  closestToPinWinners: ClosestToPinWinnersMap;
}): BetResults {
  const { details, players, bets, scores, closestToPinWinners } = args;
  const holes = holesInPlayOrder(details.holes, details.startingHole);

  const results: BetResults = {
    perPlayerTotalNet: emptyNet(players),
    settlement: [],
  };

  if (bets.skins.enabled && bets.skins.amount > 0) {
    results.skins = computeSkins(holes, players, scores, bets.skins.amount);
    addNet(results.perPlayerTotalNet, results.skins.perPlayerNet);
  }

  if (bets.nassau.enabled) {
    results.nassau = computeNassau(details, players, scores, bets.nassau);
    addNet(results.perPlayerTotalNet, results.nassau.perPlayerNet);
  }

  if (bets.teamMatch.enabled) {
    const tm = computeTeamMatch(players, bets.teamMatch, scores, holes);
    if (tm) {
      results.teamMatch = tm;
      addNet(results.perPlayerTotalNet, tm.perPlayerNet);
    }
  }

  if (bets.straightMatch.enabled) {
    const sm = computeStraightMatch(
      players,
      scores,
      bets.straightMatch,
      holes,
    );
    if (sm) {
      results.straightMatch = sm;
      addNet(results.perPlayerTotalNet, sm.perPlayerNet);
    }
  }

  if (bets.closestToPin.enabled) {
    const ctp = computeClosestToPin(
      players,
      bets.closestToPin,
      closestToPinWinners,
    );
    if (ctp) {
      results.closestToPin = ctp;
      addNet(results.perPlayerTotalNet, ctp.perPlayerNet);
    }
  }

  results.perPlayerTotalNet = roundNetMap(results.perPlayerTotalNet);
  results.settlement = computeSettlement(results.perPlayerTotalNet);

  return results;
}

function roundNetMap(net: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(net)) out[id] = roundCents(net[id]);
  return out;
}
