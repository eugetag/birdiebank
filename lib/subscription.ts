/**
 * Subscription tier + monthly round limits (localStorage preview).
 *
 * No Stripe or auth — tiers are stored locally for beta UX previews.
 */

import { listRounds } from "./rounds";

export type SubscriptionTier = "free" | "birdie" | "founder";

export const FREE_MONTHLY_ROUND_LIMIT = 4;

/** When true, free tier users cannot start a 5th round in a calendar month. */
export const PAYWALL_ENFORCEMENT_ENABLED = false;

const SUBSCRIPTION_KEY = "gbl:subscription";

type SubscriptionState = {
  tier: SubscriptionTier;
  monthKey: string;
  monthlyRoundIds: string[];
};

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function getMonthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function defaultState(): SubscriptionState {
  return {
    tier: "free",
    monthKey: getMonthKey(),
    monthlyRoundIds: [],
  };
}

function safeParseState(raw: string | null): SubscriptionState | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SubscriptionState>;
    const tier = parsed.tier;
    if (tier !== "free" && tier !== "birdie" && tier !== "founder") {
      return undefined;
    }
    return {
      tier,
      monthKey:
        typeof parsed.monthKey === "string" ? parsed.monthKey : getMonthKey(),
      monthlyRoundIds: Array.isArray(parsed.monthlyRoundIds)
        ? parsed.monthlyRoundIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return undefined;
  }
}

function readState(): SubscriptionState {
  if (!isBrowser()) return defaultState();
  const stored = safeParseState(window.localStorage.getItem(SUBSCRIPTION_KEY));
  return stored ?? defaultState();
}

function writeState(state: SubscriptionState): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(state));
}

/** Ensure round ids for the current calendar month include finalized local rounds. */
function syncMonthlyRoundIds(state: SubscriptionState): SubscriptionState {
  const monthKey = getMonthKey();
  if (state.monthKey !== monthKey) {
    return { tier: state.tier, monthKey, monthlyRoundIds: [] };
  }

  const fromRounds = listRounds()
    .filter((r) => r.createdAt.startsWith(monthKey))
    .map((r) => r.id);

  const merged = new Set([...state.monthlyRoundIds, ...fromRounds]);
  return { ...state, monthKey, monthlyRoundIds: [...merged] };
}

function stateForCurrentMonth(): SubscriptionState {
  const synced = syncMonthlyRoundIds(readState());
  if (
    synced.monthKey !== readState().monthKey ||
    synced.monthlyRoundIds.length !== readState().monthlyRoundIds.length
  ) {
    writeState(synced);
  }
  return synced;
}

export function getSubscriptionTier(): SubscriptionTier {
  return stateForCurrentMonth().tier;
}

export function setSubscriptionTier(tier: SubscriptionTier): void {
  const state = stateForCurrentMonth();
  writeState({ ...state, tier });
}

export function getMonthlyRoundCount(): number {
  return stateForCurrentMonth().monthlyRoundIds.length;
}

export function hasUnlimitedRounds(): boolean {
  const tier = getSubscriptionTier();
  return tier === "birdie" || tier === "founder";
}

/** Free tier user attempting round #(limit + 1) this month. */
export function shouldPreviewPaywall(): boolean {
  if (hasUnlimitedRounds()) return false;
  return getMonthlyRoundCount() >= FREE_MONTHLY_ROUND_LIMIT;
}

export function wouldBlockRoundCreation(): boolean {
  return PAYWALL_ENFORCEMENT_ENABLED && shouldPreviewPaywall();
}

export function recordRoundStarted(roundId: string): void {
  if (!roundId || !isBrowser()) return;
  const state = stateForCurrentMonth();
  const monthKey = getMonthKey();
  const monthlyRoundIds =
    state.monthKey === monthKey ? [...state.monthlyRoundIds] : [];
  if (!monthlyRoundIds.includes(roundId)) {
    monthlyRoundIds.push(roundId);
  }
  writeState({ tier: state.tier, monthKey, monthlyRoundIds });
}

export function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case "birdie":
      return "Birdie Plan";
    case "founder":
      return "Founder Beta";
    default:
      return "TeeTabs Free";
  }
}
