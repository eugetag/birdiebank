/**
 * Dashboard service — Supabase-first with localStorage fallback.
 */

import { getDirectory } from "./directory";
import {
  emptyCurrencyBag,
  getLedger,
  getPlayerLedgerStats,
  type CurrencyBag,
} from "./ledger";
import { getNotifications } from "./notifications";
import { listRounds } from "./rounds";
import type { LedgerEntry, Notification, Round } from "./types";

export type DashboardQuickRound = {
  id: string;
  supabaseRoundId?: string;
  courseName: string;
  roundName?: string;
  date: string;
  holes: 9 | 18;
  startingHole: 1 | 10;
};

export type DashboardNotification = Pick<
  Notification,
  "id" | "type" | "status" | "message" | "createdAt" | "date" | "courseName"
>;

export type DashboardPlayerPreview = {
  contactKey: string;
  name: string;
  preferredMethod?: string;
  net: CurrencyBag;
};

export type UnsettledSummary = {
  outstanding: CurrencyBag;
  pendingCount: number;
  unsettledCount: number;
  payers: number;
  receivers: number;
};

export type DashboardData = {
  outcome: "cloud" | "local";
  unsettledSummary: UnsettledSummary;
  unsettledEntries: LedgerEntry[];
  recentRounds: DashboardQuickRound[];
  notificationHistory: DashboardNotification[];
  playerDirectory: DashboardPlayerPreview[];
};

function sumOutstanding(entries: ReadonlyArray<LedgerEntry>): UnsettledSummary {
  const outstanding = emptyCurrencyBag();
  const payers = new Set<string>();
  const receivers = new Set<string>();
  let pendingCount = 0;
  let unsettledCount = 0;
  for (const e of entries) {
    if (e.status !== "pending" && e.status !== "disputed") continue;
    unsettledCount += 1;
    if (e.status === "pending") pendingCount += 1;
    outstanding[e.currency] += e.amount;
    payers.add(e.payerContactKey);
    receivers.add(e.receiverContactKey);
  }
  return {
    outstanding,
    pendingCount,
    unsettledCount,
    payers: payers.size,
    receivers: receivers.size,
  };
}

function toQuickRoundsLocal(rounds: Round[], limit: number): DashboardQuickRound[] {
  return rounds.slice(0, limit).map((r) => ({
    id: r.id,
    supabaseRoundId: r.supabaseRoundId,
    courseName: r.details.courseName,
    roundName: r.details.roundName,
    date: r.details.date,
    holes: r.details.holes,
    startingHole: r.details.startingHole,
  }));
}

function notificationPreview(n: Notification): DashboardNotification {
  const message = n.message.length > 140 ? `${n.message.slice(0, 140)}…` : n.message;
  return {
    id: n.id,
    type: n.type,
    status: n.status,
    message,
    createdAt: n.createdAt,
    date: n.date,
    courseName: n.courseName,
  };
}

function buildPlayerPreview(
  entries: ReadonlyArray<LedgerEntry>,
): DashboardPlayerPreview[] {
  const directory = getDirectory();
  return Object.values(directory)
    .slice(0, 12)
    .map((d) => {
      const stats = getPlayerLedgerStats(d.normalizedContactKey, entries);
      return {
        contactKey: d.normalizedContactKey,
        name: d.displayName,
        preferredMethod: d.preferredMethod,
        net: stats.net,
      };
    });
}

async function fetchRemoteDashboard(limit: {
  rounds: number;
  notifications: number;
  players: number;
}): Promise<
  | { ok: true; data: Omit<DashboardData, "outcome"> }
  | { ok: false; reason: "unconfigured" | "error"; error: unknown }
> {
  let mod: typeof import("./supabase/client");
  try {
    mod = await import("./supabase/client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const supabase = mod.supabase;

    const [ledgerRes, roundsRes, notifRes, playersRes] = await Promise.all([
      supabase
        .from("ledger_entries")
        .select("*")
        .in("status", ["pending", "disputed"]),
      supabase
        .from("rounds")
        .select("id, course_name, round_name, round_date, holes, starting_hole")
        .order("round_date", { ascending: false })
        .limit(limit.rounds),
      supabase
        .from("notifications")
        .select("id, type, status, message, created_at, date, course_name")
        .order("created_at", { ascending: false })
        .limit(limit.notifications),
      supabase
        .from("players")
        .select("display_name, preferred_method, normalized_contact_key")
        .order("updated_at", { ascending: false })
        .limit(limit.players),
    ]);

    if (ledgerRes.error) throw ledgerRes.error;
    if (roundsRes.error) throw roundsRes.error;
    if (notifRes.error) throw notifRes.error;
    if (playersRes.error) throw playersRes.error;

    const ledgerRows = (Array.isArray(ledgerRes.data) ? ledgerRes.data : []) as unknown[];
    const roundsRows = (Array.isArray(roundsRes.data) ? roundsRes.data : []) as unknown[];
    const notifRows = (Array.isArray(notifRes.data) ? notifRes.data : []) as unknown[];
    const playerRows = (Array.isArray(playersRes.data) ? playersRes.data : []) as unknown[];

    const { rowToLedgerEntry } = await import("./supabase/ledger");
    const unsettledEntries: LedgerEntry[] = ledgerRows
      .map((r) => rowToLedgerEntry(r as import("./supabase/types").LedgerEntryRow))
      .filter((e) => Number.isFinite(e.amount));

    const recentRounds: DashboardQuickRound[] = roundsRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        supabaseRoundId: String(row.id),
        courseName: String(row.course_name ?? "—"),
        roundName: typeof row.round_name === "string" ? row.round_name : undefined,
        date: String(row.round_date ?? ""),
        holes: row.holes === 9 ? 9 : 18,
        startingHole: row.starting_hole === 10 ? 10 : 1,
      };
    });

    const notificationHistory: DashboardNotification[] = notifRows.map((r) => {
      const row = r as Record<string, unknown>;
      const message = String(row.message ?? "");
      return {
        id: String(row.id),
        type: row.type as DashboardNotification["type"],
        status: row.status as DashboardNotification["status"],
        message: message.length > 140 ? `${message.slice(0, 140)}…` : message,
        createdAt: String(row.created_at),
        date: typeof row.date === "string" ? row.date : undefined,
        courseName: typeof row.course_name === "string" ? row.course_name : undefined,
      };
    });

    const playerDirectory: DashboardPlayerPreview[] = playerRows.map((r) => {
      const row = r as Record<string, unknown>;
      const contactKey = String(row.normalized_contact_key ?? "");
      const stats = contactKey ? getPlayerLedgerStats(contactKey, unsettledEntries) : null;
      return {
        contactKey,
        name: String(row.display_name ?? "—"),
        preferredMethod: typeof row.preferred_method === "string" ? row.preferred_method : undefined,
        net: stats ? stats.net : emptyCurrencyBag(),
      };
    });

    return {
      ok: true,
      data: {
        unsettledEntries,
        unsettledSummary: sumOutstanding(unsettledEntries),
        recentRounds,
        notificationHistory,
        playerDirectory,
      },
    };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}

export async function loadDashboardData(): Promise<DashboardData> {
  const localLedger = getLedger();
  const unsettledLocal = localLedger.filter(
    (e) => e.status === "pending" || e.status === "disputed",
  );
  const localRounds = toQuickRoundsLocal(listRounds(), 10);
  const localNotifications = getNotifications()
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map(notificationPreview);
  const localPlayers = buildPlayerPreview(unsettledLocal);

  const remote = await fetchRemoteDashboard({
    rounds: 10,
    notifications: 20,
    players: 12,
  });

  if (!remote.ok) {
    return {
      outcome: "local",
      unsettledEntries: unsettledLocal,
      unsettledSummary: sumOutstanding(unsettledLocal),
      recentRounds: localRounds,
      notificationHistory: localNotifications,
      playerDirectory: localPlayers,
    };
  }

  return { outcome: "cloud", ...remote.data };
}

