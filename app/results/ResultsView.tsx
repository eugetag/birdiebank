"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ensureDraftId,
  finalizeDraft,
  getDraft,
  setDraftPlayer,
  setDraftResults,
} from "@/lib/rounds";
import { getDraftSupabaseRoundId } from "@/lib/rounds-service";
import { useHasHydrated } from "@/lib/hooks";
import { computeBetResults } from "@/lib/settlement";
import {
  buildMemo,
  buildPaymentInstruction,
  currencyForCountry,
  formatInstructionText,
  formatMoney as formatMoneyWithCurrency,
  methodsForCountry,
  type PaymentInstruction,
} from "@/lib/payments";
import {
  getDirectory,
  normalizeContactKey,
  saveDirectoryEntry,
  type DirectoryMap,
} from "@/lib/directory";
import {
  currentRoundLedgerContextFromDetails,
  findDuplicateLedgerEntry,
  getPlayerLedgerStats,
  getPriorUnsettledEntriesForContact,
  type CurrencyBag,
} from "@/lib/ledger";
import {
  getLedgerEntries,
  saveLedgerEntry,
  updateLedgerStatus as updateLedgerStatusService,
  type SaveLedgerResult,
  type SupabaseErrorDetails,
} from "@/lib/ledger-service";
import { getNotifications, type NotificationInput } from "@/lib/notifications";
import {
  loadNotificationHistoryForResults,
  syncMarkNotificationSent,
  syncUpsertNotificationDraft,
  syncUpdateNotificationStatus,
} from "@/lib/notifications-service";
import type { PlayersRemoteResult } from "@/lib/supabase/players";
import {
  buildEmailMessage,
  buildSmsMessage,
  emailToText,
  type EmailMessage,
} from "@/lib/notification-templates";
import type {
  BetResults,
  Bets,
  ClosestToPinResult,
  ClosestToPinWinnersMap,
  Country,
  Currency,
  DirectoryEntry,
  LedgerEntry,
  LedgerStatus,
  LedgerSyncState,
  NassauResult,
  NassauSegmentResult,
  Notification,
  NotificationStatus,
  NotificationType,
  PaymentMethod,
  PaymentProfile,
  Player,
  RoundDetails,
  ScoresMap,
  SettlementTransaction,
  SkinsResult,
  StraightMatchResult,
  TeamMatchResult,
} from "@/lib/types";

export default function ResultsView() {
  const hasHydrated = useHasHydrated();

  if (!hasHydrated) {
    return <ViewSkeleton />;
  }

  const draft = getDraft();
  if (!draft?.details) {
    return (
      <EmptyCard
        title="No round in progress"
        body="Start a new round to see results here."
        href="/create-round"
        label="Start a round"
      />
    );
  }
  if (!draft.players || draft.players.length < 2) {
    return (
      <EmptyCard
        title="Add players first"
        body="Results need at least two players."
        href="/players"
        label="Add players"
      />
    );
  }
  if (!draft.bets) {
    return (
      <EmptyCard
        title="Pick bets first"
        body="There's nothing to settle without bets."
        href="/bets"
        label="Set bets"
      />
    );
  }
  const ctpWinners = draft.closestToPinWinners ?? {};
  if (
    !draft.scores ||
    !allScoresPresent(
      draft.scores,
      draft.players,
      draft.bets,
      draft.details,
      ctpWinners,
    )
  ) {
    return (
      <EmptyCard
        title="Finish the scorecard"
        body="Add a score for every player on every hole before settling up."
        href="/scorecard"
        label="Back to scorecard"
      />
    );
  }

  return (
    <ResultsInner
      details={draft.details}
      initialPlayers={draft.players}
      bets={draft.bets}
      scores={draft.scores}
      ctpWinners={ctpWinners}
    />
  );
}

function ResultsInner({
  details,
  initialPlayers,
  bets,
  scores,
  ctpWinners,
}: {
  details: RoundDetails;
  initialPlayers: Player[];
  bets: Bets;
  scores: ScoresMap;
  ctpWinners: ClosestToPinWinnersMap;
}) {
  const router = useRouter();

  // Local players state so saving settlement info on this page is reflected
  // immediately (and persisted to the draft via setDraftPlayer).
  const [players, setPlayers] = useState<Player[]>(initialPlayers);

  // Cross-round directory + ledger snapshots. Re-read after every mutation.
  const [directory, setDirectory] = useState<DirectoryMap>(() => getDirectory());
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(() =>
    getNotifications(),
  );
  const [notificationsSyncOutcome, setNotificationsSyncOutcome] = useState<
    "cloud" | "local" | null
  >(null);

  // Stable round id reused on finalize. Generated lazily so we don't write
  // the draft just by visiting this page.
  const roundId = useMemo(() => ensureDraftId(), []);

  const playerContactKeys = useMemo(
    () =>
      players.map((p) =>
        p.normalizedContactKey ??
        normalizeContactKey({ fallbackId: p.id }),
      ),
    [players],
  );

  const supabaseRoundId = useMemo(() => getDraftSupabaseRoundId(), []);

  const currentRoundLedgerCtx = useMemo(
    () =>
      currentRoundLedgerContextFromDetails(
        roundId,
        details,
        supabaseRoundId,
      ),
    [roundId, details, supabaseRoundId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const merged = await getLedgerEntries({
        contactKeys: playerContactKeys,
      });
      if (!cancelled) {
        setLedger(merged);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerContactKeys]);

  // Supabase first; localStorage is our fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadNotificationHistoryForResults({
        localRoundId: roundId,
        supabaseRoundId,
        details: {
          roundName: details.roundName,
          courseName: details.courseName,
          date: details.date,
        },
      });
      if (cancelled) return;
      setNotifications(loaded.notifications);
      setNotificationsSyncOutcome(loaded.outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [roundId, supabaseRoundId, details.courseName, details.date, details.roundName]);

  const results = useMemo<BetResults>(
    () =>
      computeBetResults({
        details,
        players,
        bets,
        scores,
        closestToPinWinners: ctpWinners,
      }),
    [details, players, bets, scores, ctpWinners],
  );

  // Persist computed results into the draft so refreshing or finalizing
  // keeps a snapshot of the math.
  useEffect(() => {
    setDraftResults(results);
  }, [results]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of players) map.set(p.id, p.name);
    return (id: string | null | undefined) =>
      (id && map.get(id)) || "—";
  }, [players]);

  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [confirmReset, setConfirmReset] = useState(false);

  // Look up a player by id so we can derive payment instructions per row.
  const playersById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  /**
   * Save a player's settlement info into the cross-round directory and stamp
   * the round player with the resulting `normalizedContactKey`. This is the
   * only path that creates / updates directory rows.
   */
  /**
   * Save settlement info for one player. Writes localStorage synchronously
   * (so the directory snapshot in state reflects the new entry on this tick)
   * and returns the in-flight Supabase mirror promise so the calling card
   * can show a "Saving… / Saved to Cloud / Local fallback" pill.
   */
  function handleSavePlayer(
    playerId: string,
    form: PlayerInfoForm,
  ): Promise<PlayersRemoteResult> | null {
    const player = playersById.get(playerId);
    if (!player) return null;

    const trimmedName = form.displayName.trim() || player.name;
    const email = form.email?.trim() || undefined;
    const phone = form.phone?.trim() || undefined;
    const normalizedContactKey = normalizeContactKey({
      email,
      phone,
      fallbackId: playerId,
    });

    const { remote } = saveDirectoryEntry({
      existingId: player.normalizedContactKey
        ? directory[player.normalizedContactKey]?.id
        : undefined,
      displayName: trimmedName,
      email,
      phone,
      normalizedContactKey,
      country: form.country,
      preferredMethod: form.preferredMethod,
      interacEmail: form.interacEmail?.trim() || undefined,
      interacPhone: form.interacPhone?.trim() || undefined,
      venmoHandle: form.venmoHandle?.trim() || undefined,
      cashAppTag: form.cashAppTag?.trim() || undefined,
      paypalLink: form.paypalLink?.trim() || undefined,
      zelleEmail: form.zelleEmail?.trim() || undefined,
      zellePhone: form.zellePhone?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
    });

    const profile: PaymentProfile = {
      country: form.country,
      preferredMethod: form.preferredMethod,
      interacEmail: form.interacEmail?.trim() || undefined,
      interacPhone: form.interacPhone?.trim() || undefined,
      venmoHandle: form.venmoHandle?.trim() || undefined,
      cashAppTag: form.cashAppTag?.trim() || undefined,
      paypalLink: form.paypalLink?.trim() || undefined,
      zelleEmail: form.zelleEmail?.trim() || undefined,
      zellePhone: form.zellePhone?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
    };

    const updatedPlayer: Player = {
      ...player,
      name: trimmedName,
      paymentProfile: profile,
      normalizedContactKey,
    };

    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? updatedPlayer : p)),
    );
    setDraftPlayer(updatedPlayer);
    setDirectory(getDirectory());

    return remote;
  }

  /**
   * Derive the canonical contact key for a round player. We prefer the key
   * already stamped on the player; otherwise we fall back to a guest key so
   * the ledger still has a valid stable string.
   */
  function contactKeyFor(playerId: string): string {
    const player = playersById.get(playerId);
    if (player?.normalizedContactKey) return player.normalizedContactKey;
    return `guest:${playerId}`;
  }

  function pickCurrency(receiverId: string): Currency {
    const receiver = playersById.get(receiverId);
    const country =
      receiver?.paymentProfile?.country ??
      (receiver?.normalizedContactKey
        ? directory[receiver.normalizedContactKey]?.country
        : undefined);
    return currencyForCountry(country);
  }

  async function refreshLedger(): Promise<void> {
    const merged = await getLedgerEntries({
      contactKeys: playerContactKeys,
    });
    setLedger(merged);
  }

  async function handleAddToLedger(
    t: SettlementTransaction,
  ): Promise<SaveLedgerResult | null> {
    const payer = playersById.get(t.fromId);
    const receiver = playersById.get(t.toId);
    const input = {
      roundId,
      roundName: details.roundName,
      courseName: details.courseName,
      date: details.date,
      payerContactKey: contactKeyFor(t.fromId),
      payerName: payer?.name ?? nameOf(t.fromId),
      receiverContactKey: contactKeyFor(t.toId),
      receiverName: receiver?.name ?? nameOf(t.toId),
      amount: round2(t.amount),
      currency: pickCurrency(t.toId),
      status: "pending" as const,
      paymentMethod: receiver?.paymentProfile?.preferredMethod,
      memo: buildMemo(details),
    };
    const result = await saveLedgerEntry(input);
    await refreshLedger();
    return result;
  }

  async function handleUpdateLedgerStatus(
    id: string,
    status: LedgerStatus,
  ): Promise<void> {
    await updateLedgerStatusService(id, status);
    await refreshLedger();
  }

  function handleUpsertNotification(
    input: NotificationInput & { status: NotificationStatus },
  ): Notification {
    const draftInput = (
      input.status === "draft" ? input : { ...input, status: "draft" }
    ) as NotificationInput & { status: "draft" };

    const { notification, remoteSync } = syncUpsertNotificationDraft({
      input: draftInput,
      supabaseRoundId,
    });

    setNotifications(getNotifications());
    remoteSync.then((outcome) => setNotificationsSyncOutcome(outcome));
    return notification;
  }

  function handleMarkNotificationSent(input: NotificationInput): Notification {
    const { notification, remoteSync } = syncMarkNotificationSent({
      input,
      supabaseRoundId,
    });
    setNotifications(getNotifications());
    remoteSync.then((outcome) => setNotificationsSyncOutcome(outcome));
    return notification;
  }

  function handleUpdateNotificationStatus(
    id: string,
    status: NotificationStatus,
  ): void {
    const { remoteSync } = syncUpdateNotificationStatus({
      id,
      status,
      supabaseRoundId,
    });
    setNotifications(getNotifications());
    remoteSync?.then((outcome) => setNotificationsSyncOutcome(outcome));
  }

  async function handleCopy() {
    const text = formatSummaryText({ details, players, results, nameOf });
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
      } else {
        // Fallback: tiny textarea + execCommand
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopyState("copied");
      }
    } catch {
      setCopyState("error");
    } finally {
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  function handleStartNewRound() {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    finalizeDraft();
    router.push("/create-round");
  }

  function handleBack() {
    router.push("/scorecard");
  }

  return (
    <div className="flex flex-col gap-4">
      <RoundSummary details={details} />

      <PlayerSettlementInfoCard
        players={players}
        directory={directory}
        onSavePlayer={handleSavePlayer}
      />

      <PreviousUnsettledBetsCard
        players={players}
        ledger={ledger}
        currentRoundCtx={currentRoundLedgerCtx}
        contactKeyFor={contactKeyFor}
        onUpdateStatus={handleUpdateLedgerStatus}
      />

      <SettlementCard
        settlement={results.settlement}
        details={details}
        playersById={playersById}
        ledger={ledger}
        contactKeyFor={contactKeyFor}
        pickCurrency={pickCurrency}
        nameOf={nameOf}
        onCopy={handleCopy}
        copyState={copyState}
        onAddToLedger={handleAddToLedger}
        onUpdateLedgerStatus={handleUpdateLedgerStatus}
      />

      <NotificationsCard
        settlement={results.settlement}
        details={details}
        playersById={playersById}
        directory={directory}
        ledger={ledger}
        notifications={notifications}
        roundId={roundId}
        contactKeyFor={contactKeyFor}
        pickCurrency={pickCurrency}
        nameOf={nameOf}
        onUpsertNotification={handleUpsertNotification}
        onMarkNotificationSent={handleMarkNotificationSent}
      />

      <NetTotalsCard players={players} net={results.perPlayerTotalNet} />

      {results.skins ? (
        <SkinsCard
          skins={results.skins}
          players={players}
          nameOf={nameOf}
        />
      ) : null}

      {results.nassau ? (
        <NassauCard
          nassau={results.nassau}
          players={players}
          nameOf={nameOf}
        />
      ) : null}

      {results.teamMatch ? (
        <TeamMatchCard tm={results.teamMatch} nameOf={nameOf} />
      ) : null}

      {results.straightMatch ? (
        <StraightMatchCard
          match={results.straightMatch}
          nameOf={nameOf}
        />
      ) : null}

      {results.closestToPin ? (
        <ClosestToPinCard
          ctp={results.closestToPin}
          players={players}
          nameOf={nameOf}
        />
      ) : null}

      <NotificationHistoryCard
        notifications={notifications}
        onUpdateStatus={handleUpdateNotificationStatus}
        syncOutcome={notificationsSyncOutcome}
      />

      <ActionBar>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-12 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:h-11"
        >
          Back to Scorecard
        </button>
        <button
          type="button"
          onClick={handleStartNewRound}
          className={[
            "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium shadow-sm transition active:scale-[0.99] sm:h-11 sm:flex-none",
            confirmReset
              ? "bg-flag text-white hover:bg-flag/90"
              : "bg-fairway-700 text-cream hover:bg-fairway-600",
          ].join(" ")}
        >
          {confirmReset ? "Tap again to confirm" : "Start new round"}
        </button>
      </ActionBar>
    </div>
  );
}

/* ---------- Settlement ---------- */

function SettlementCard({
  settlement,
  details,
  playersById,
  ledger,
  contactKeyFor,
  pickCurrency,
  nameOf,
  onCopy,
  copyState,
  onAddToLedger,
  onUpdateLedgerStatus,
}: {
  settlement: SettlementTransaction[];
  details: RoundDetails;
  playersById: Map<string, Player>;
  ledger: LedgerEntry[];
  contactKeyFor: (playerId: string) => string;
  pickCurrency: (receiverId: string) => Currency;
  nameOf: (id: string | null | undefined) => string;
  onCopy: () => void;
  copyState: "idle" | "copied" | "error";
  onAddToLedger: (
    t: SettlementTransaction,
  ) => Promise<SaveLedgerResult | null>;
  onUpdateLedgerStatus: (
    id: string,
    status: LedgerStatus,
  ) => Promise<void>;
}) {
  const copyLabel =
    copyState === "copied"
      ? "Copied!"
      : copyState === "error"
        ? "Couldn't copy"
        : "Copy summary";

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-fairway-200 bg-fairway-50 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
            Settle up
          </span>
          <h2 className="text-xl font-semibold tracking-tight text-fairway-900 sm:text-2xl">
            {settlement.length === 0
              ? "Everyone's settled up"
              : `${settlement.length} ${settlement.length === 1 ? "payment" : "payments"} to settle`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCopy}
          aria-live="polite"
          className={[
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
            copyState === "copied"
              ? "border-fairway-600 bg-fairway-700 text-cream"
              : "border-sand bg-white text-fairway-800 hover:bg-cream",
          ].join(" ")}
        >
          <CopyIcon className="h-4 w-4" />
          {copyLabel}
        </button>
      </header>

      <p className="rounded-xl border border-fairway-200/70 bg-white/70 px-3 py-2 text-xs text-fairway-900/70">
        Golf Bet Ledger is a settlement assistant — we never process or hold
        funds. Use these instructions to send money on your preferred app, then
        track each debt in your running ledger.
      </p>

      {settlement.length === 0 ? (
        <p className="text-sm text-fairway-900/70">
          No money changes hands — the bets balanced out.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {settlement.map((t, i) => {
            const payee = playersById.get(t.toId);
            const payer = playersById.get(t.fromId);
            const instruction: PaymentInstruction = payee
              ? buildPaymentInstruction(payee, round2(t.amount), details)
              : {
                  methodLabel: "No payment info on file",
                  destination: null,
                  memo: buildMemo(details),
                  hasProfile: false,
                  hasContact: false,
                };
            const currency = pickCurrency(t.toId);
            const payerKey = contactKeyFor(t.fromId);
            const receiverKey = contactKeyFor(t.toId);
            const existingEntry = findDuplicateLedgerEntry(ledger, {
              roundName: details.roundName,
              courseName: details.courseName,
              date: details.date,
              payerContactKey: payerKey,
              receiverContactKey: receiverKey,
              amount: round2(t.amount),
            });
            return (
              <SettlementRow
                key={`${t.fromId}-${t.toId}-${i}`}
                transaction={t}
                payerName={nameOf(t.fromId)}
                payeeName={nameOf(t.toId)}
                payeeHasName={!!payer && !!payee}
                currency={currency}
                instruction={instruction}
                ledgerEntry={existingEntry}
                onAddToLedger={() => onAddToLedger(t)}
                onUpdateLedgerStatus={onUpdateLedgerStatus}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SettlementRow({
  transaction,
  payerName,
  payeeName,
  payeeHasName,
  currency,
  instruction,
  ledgerEntry,
  onAddToLedger,
  onUpdateLedgerStatus,
}: {
  transaction: SettlementTransaction;
  payerName: string;
  payeeName: string;
  payeeHasName: boolean;
  currency: Currency;
  instruction: PaymentInstruction;
  ledgerEntry: LedgerEntry | undefined;
  onAddToLedger: () => Promise<SaveLedgerResult | null>;
  onUpdateLedgerStatus: (id: string, status: LedgerStatus) => Promise<void>;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "error">("idle");
  const [ledgerSyncUi, setLedgerSyncUi] = useState<
    "idle" | "saving" | LedgerSyncState
  >("idle");
  const [ledgerSyncError, setLedgerSyncError] =
    useState<SupabaseErrorDetails | null>(null);

  async function handleAddToLedger() {
    setLedgerSyncUi("saving");
    setLedgerSyncError(null);
    try {
      const result = await onAddToLedger();
      if (!result) {
        setLedgerSyncUi("idle");
        return;
      }
      setLedgerSyncUi(result.outcome);
      if (result.remoteError) {
        setLedgerSyncError(result.remoteError);
      }
    } catch (err) {
      setLedgerSyncUi("error");
      setLedgerSyncError({
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      window.setTimeout(() => {
        setLedgerSyncUi((prev) =>
          prev === "saving" || prev === "error" ? prev : "idle",
        );
      }, 3200);
    }
  }

  async function handleCopyInstruction() {
    const text = formatInstructionText({
      payerName,
      payeeName,
      amount: round2(transaction.amount),
      currency,
      instruction,
    });
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
        setCopy("copied");
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopy("copied");
      }
    } catch {
      setCopy("error");
    } finally {
      window.setTimeout(() => setCopy("idle"), 2000);
    }
  }

  const copyLabel =
    copy === "copied"
      ? "Copied!"
      : copy === "error"
        ? "Couldn't copy"
        : "Copy instruction";

  return (
    <li className="overflow-hidden rounded-xl border border-fairway-200 bg-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0 text-sm text-fairway-900">
          <span className="font-semibold">{payerName}</span>{" "}
          <span className="text-fairway-900/60">owes</span>{" "}
          <span className="font-semibold">{payeeName}</span>
        </span>
        <span className="font-mono text-base font-semibold tabular-nums text-fairway-900">
          {formatMoneyWithCurrency(transaction.amount, currency)}
        </span>
      </header>

      <dl className="grid grid-cols-[5rem_1fr] gap-y-1 border-t border-fairway-100 bg-fairway-50/40 px-4 py-3 text-sm">
        <dt className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          Method
        </dt>
        <dd
          className={[
            "min-w-0 break-words",
            instruction.hasProfile
              ? "font-semibold text-fairway-900"
              : "text-fairway-900/60",
          ].join(" ")}
        >
          {instruction.methodLabel}
        </dd>

        <dt className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          Send to
        </dt>
        <dd
          className={[
            "min-w-0 break-words font-mono text-sm",
            instruction.destination
              ? "text-fairway-900"
              : "text-flag/80",
          ].join(" ")}
        >
          {instruction.destination ??
            (payeeHasName
              ? `No settlement method saved for ${payeeName} yet.`
              : "No settlement method on file yet.")}
        </dd>

        <dt className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          Memo
        </dt>
        <dd className="min-w-0 break-words text-fairway-900/80">
          {instruction.memo}
        </dd>
      </dl>

      <div className="flex flex-col gap-2 border-t border-fairway-100 bg-white px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleCopyInstruction}
            aria-live="polite"
            className={[
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
              copy === "copied"
                ? "border-fairway-600 bg-fairway-700 text-cream"
                : "border-sand bg-white text-fairway-800 hover:bg-cream",
            ].join(" ")}
          >
            <CopyIcon className="h-4 w-4" />
            {copyLabel}
          </button>
          {ledgerEntry ? (
            <div className="flex flex-col items-end gap-1.5 sm:ml-auto">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-fairway-300 bg-fairway-100 px-3 text-[11px] font-semibold uppercase tracking-wider text-fairway-700">
                <CheckIcon className="h-3 w-3" />
                Added to Ledger
              </span>
              <LedgerSyncPill
                syncState={ledgerEntry.syncState ?? ledgerSyncUi}
              />
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1.5 sm:ml-auto">
              <button
                type="button"
                onClick={handleAddToLedger}
                disabled={ledgerSyncUi === "saving"}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-fairway-700 px-4 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40"
              >
                <PlusIcon className="h-4 w-4" />
                {ledgerSyncUi === "saving" ? "Saving…" : "Add to Ledger"}
              </button>
              {ledgerSyncUi !== "idle" && ledgerSyncUi !== "saving" ? (
                <LedgerSyncPill syncState={ledgerSyncUi} />
              ) : null}
            </div>
          )}
        </div>
        {ledgerSyncError ? (
          <LedgerSyncErrorDetails error={ledgerSyncError} />
        ) : null}
        {ledgerEntry ? (
          <LedgerStatusBar
            status={ledgerEntry.status}
            onChange={(next) => void onUpdateLedgerStatus(ledgerEntry.id, next)}
          />
        ) : null}
      </div>
    </li>
  );
}

function LedgerSyncErrorDetails({ error }: { error: SupabaseErrorDetails }) {
  return (
    <div
      className="rounded-xl border border-rose-300 bg-rose-50 p-3"
      role="alert"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
        Ledger sync error
      </p>
      <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-y-1 text-xs text-rose-900">
        <dt className="font-semibold uppercase tracking-wider text-rose-700/80">
          Message
        </dt>
        <dd className="min-w-0 break-words font-mono">{error.message}</dd>
        {error.code ? (
          <>
            <dt className="font-semibold uppercase tracking-wider text-rose-700/80">
              Code
            </dt>
            <dd className="min-w-0 break-words font-mono">{error.code}</dd>
          </>
        ) : null}
        {error.details ? (
          <>
            <dt className="font-semibold uppercase tracking-wider text-rose-700/80">
              Details
            </dt>
            <dd className="min-w-0 break-words font-mono">{error.details}</dd>
          </>
        ) : null}
        {error.hint ? (
          <>
            <dt className="font-semibold uppercase tracking-wider text-rose-700/80">
              Hint
            </dt>
            <dd className="min-w-0 break-words font-mono">{error.hint}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function LedgerSyncPill({
  syncState,
}: {
  syncState: LedgerSyncState | "saving" | "idle";
}) {
  if (syncState === "idle") return null;
  const palette = LEDGER_SYNC_PALETTE[syncState];
  const label = LEDGER_SYNC_LABEL[syncState];
  const icon = LEDGER_SYNC_ICON[syncState];
  return (
    <span
      className={[
        "inline-flex h-5 w-fit items-center gap-1 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        palette,
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      {icon}
      {label}
    </span>
  );
}

const LEDGER_SYNC_LABEL: Record<
  LedgerSyncState | "saving",
  string
> = {
  saving: "Saving…",
  cloud: "Saved to Cloud",
  local: "Local fallback",
  error: "Sync error",
  exists: "Already exists",
};

const LEDGER_SYNC_PALETTE: Record<
  LedgerSyncState | "saving",
  string
> = {
  saving: "border-sand bg-cream/60 text-fairway-700/80",
  cloud: "border-fairway-600 bg-fairway-700 text-cream",
  local: "border-gold/60 bg-gold/15 text-gold",
  error: "border-rose-300 bg-rose-50 text-rose-700",
  exists: "border-sand bg-cream text-fairway-800",
};

const LEDGER_SYNC_ICON: Record<
  LedgerSyncState | "saving",
  React.ReactNode
> = {
  saving: <SpinnerIcon className="h-2.5 w-2.5" />,
  cloud: <CheckIcon className="h-2.5 w-2.5" />,
  local: <CloudOffIcon className="h-2.5 w-2.5" />,
  error: <CloudOffIcon className="h-2.5 w-2.5" />,
  exists: <CheckIcon className="h-2.5 w-2.5" />,
};

function LedgerStatusBar({
  status,
  onChange,
  variant = "full",
}: {
  status: LedgerStatus;
  onChange: (next: LedgerStatus) => void;
  /** Prior-round card: Paid / Disputed / Forgiven only. */
  variant?: "full" | "prior";
}) {
  const actions: { label: string; value: LedgerStatus }[] =
    variant === "prior"
      ? [
          { label: "Mark Paid", value: "paid" },
          { label: "Mark Disputed", value: "disputed" },
          { label: "Mark Forgiven", value: "forgiven" },
        ]
      : [
          { label: "Paid", value: "paid" },
          { label: "Pending", value: "pending" },
          { label: "Disputed", value: "disputed" },
          { label: "Forgiven", value: "forgiven" },
        ];

  return (
    <div
      role="group"
      aria-label="Mark ledger entry status"
      className={[
        "grid gap-2",
        variant === "prior" ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4",
      ].join(" ")}
    >
      {actions.map(({ label, value }) => (
        <StatusButton
          key={value}
          label={label}
          value={value}
          active={status === value}
          onClick={() => onChange(value)}
        />
      ))}
    </div>
  );
}

function StatusButton({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: LedgerStatus;
  active: boolean;
  onClick: () => void;
}) {
  const palette = STATUS_PALETTE[value];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold transition",
        active ? palette.active : palette.inactive,
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function StatusChip({ status }: { status: LedgerStatus }) {
  const palette = STATUS_PALETTE[status];
  return (
    <span
      className={[
        "inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        palette.active,
      ].join(" ")}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const STATUS_LABEL: Record<LedgerStatus, string> = {
  paid: "Paid",
  pending: "Pending",
  disputed: "Disputed",
  forgiven: "Forgiven",
};

const STATUS_PALETTE: Record<
  LedgerStatus,
  { active: string; inactive: string }
> = {
  paid: {
    active: "border-fairway-700 bg-fairway-700 text-cream shadow-sm",
    inactive:
      "border-sand bg-white text-fairway-800 hover:border-fairway-300 hover:bg-cream",
  },
  pending: {
    active: "border-gold bg-gold/15 text-gold shadow-sm",
    inactive:
      "border-sand bg-white text-fairway-800 hover:border-gold/50 hover:bg-cream",
  },
  disputed: {
    active: "border-flag bg-flag/10 text-flag shadow-sm",
    inactive:
      "border-sand bg-white text-fairway-800 hover:border-flag/40 hover:bg-cream",
  },
  forgiven: {
    active:
      "border-fairway-300 bg-fairway-100 text-fairway-800 shadow-sm",
    inactive:
      "border-sand bg-white text-fairway-800 hover:border-fairway-300 hover:bg-cream",
  },
};

/* ---------- Player Settlement Info ---------- */

type PlayerInfoForm = {
  displayName: string;
  email?: string;
  phone?: string;
  country: Country;
  preferredMethod: PaymentMethod;
  interacEmail?: string;
  interacPhone?: string;
  venmoHandle?: string;
  cashAppTag?: string;
  paypalLink?: string;
  zelleEmail?: string;
  zellePhone?: string;
  notes?: string;
};

const DEFAULT_INFO_COUNTRY: Country = "United States";
const DEFAULT_INFO_METHOD: PaymentMethod = "Cash";

function formFromPlayer(
  player: Player,
  directory: DirectoryMap,
): PlayerInfoForm {
  const dirEntry =
    (player.normalizedContactKey
      ? directory[player.normalizedContactKey]
      : undefined) ?? findByLegacyName(directory, player.name);

  const profile = player.paymentProfile;
  return {
    displayName: dirEntry?.displayName ?? player.name,
    email: dirEntry?.email ?? "",
    phone: dirEntry?.phone ?? "",
    country:
      profile?.country ?? dirEntry?.country ?? DEFAULT_INFO_COUNTRY,
    preferredMethod:
      profile?.preferredMethod ??
      dirEntry?.preferredMethod ??
      DEFAULT_INFO_METHOD,
    interacEmail: profile?.interacEmail ?? dirEntry?.interacEmail ?? "",
    interacPhone: profile?.interacPhone ?? dirEntry?.interacPhone ?? "",
    venmoHandle: profile?.venmoHandle ?? dirEntry?.venmoHandle ?? "",
    cashAppTag: profile?.cashAppTag ?? dirEntry?.cashAppTag ?? "",
    paypalLink: profile?.paypalLink ?? dirEntry?.paypalLink ?? "",
    zelleEmail: profile?.zelleEmail ?? dirEntry?.zelleEmail ?? "",
    zellePhone: profile?.zellePhone ?? dirEntry?.zellePhone ?? "",
    notes: profile?.notes ?? dirEntry?.notes ?? "",
  };
}

/**
 * Cheap soft-match for guest entries that don't yet have a stable contact
 * key. Helps surface existing details on first visit when only the name was
 * captured during round setup.
 */
function findByLegacyName(
  directory: DirectoryMap,
  name: string,
): DirectoryEntry | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  for (const entry of Object.values(directory)) {
    if (entry.displayName.trim().toLowerCase() === wanted) return entry;
  }
  return undefined;
}

function PlayerSettlementInfoCard({
  players,
  directory,
  onSavePlayer,
}: {
  players: Player[];
  directory: DirectoryMap;
  onSavePlayer: (
    playerId: string,
    form: PlayerInfoForm,
  ) => Promise<PlayersRemoteResult> | null;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Settlement assistant
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          Player Settlement Info
        </h2>
        <p className="text-xs text-fairway-900/70">
          Save email or phone so Golf Bet Ledger can recognise the same player
          next round and track unpaid balances.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {players.map((player) => (
          <PlayerInfoCard
            key={player.id}
            player={player}
            directory={directory}
            onSave={(form) => onSavePlayer(player.id, form)}
          />
        ))}
      </ul>
    </section>
  );
}

function PlayerInfoCard({
  player,
  directory,
  onSave,
}: {
  player: Player;
  directory: DirectoryMap;
  onSave: (form: PlayerInfoForm) => Promise<PlayersRemoteResult> | null;
}) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  // Local form state seeded from the player + directory snapshot at mount.
  // External updates (other player saves, this player save) don't mutate
  // these fields — the user's edits stay until they Save, and the freshly
  // saved values are already what they typed.
  const [form, setForm] = useState<PlayerInfoForm>(() =>
    formFromPlayer(player, directory),
  );
  // Save lifecycle: idle → saving (immediately after Save click) → cloud
  // (Supabase mirror succeeded) or local (Supabase failed / unconfigured).
  // The pill auto-fades back to idle after a few seconds so the UI doesn't
  // become noisy when editing several players in a row.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  const hasContact = !!(form.email?.trim() || form.phone?.trim());
  const directoryEntry = player.normalizedContactKey
    ? directory[player.normalizedContactKey]
    : undefined;

  function patch(updates: Partial<PlayerInfoForm>) {
    setForm((prev) => {
      const next = { ...prev, ...updates };
      if (updates.country && updates.country !== prev.country) {
        const allowed = methodsForCountry(next.country);
        if (!allowed.includes(next.preferredMethod)) {
          next.preferredMethod = allowed[0];
        }
      }
      return next;
    });
  }

  async function handleSave() {
    setSaveStatus({ kind: "saving" });
    const remote = onSave(form);
    if (!remote) {
      // Player vanished mid-save (e.g. removed). Reset silently.
      setSaveStatus({ kind: "idle" });
      return;
    }
    try {
      const result = await remote;
      setSaveStatus({ kind: result.ok ? "cloud" : "local" });
    } catch {
      // upsertPlayerRemote never rejects, but guard anyway so the pill
      // never sticks on "Saving…".
      setSaveStatus({ kind: "local" });
    } finally {
      window.setTimeout(() => {
        setSaveStatus((prev) =>
          prev.kind === "saving" ? prev : { kind: "idle" },
        );
      }, 3200);
    }
  }

  const methods = methodsForCountry(form.country);
  const showInterac = form.country === "Canada";
  const showVenmo = form.country === "United States";
  const showCashApp = form.country === "United States";
  const showZelle = form.country === "United States";

  return (
    <li className="overflow-hidden rounded-xl border border-sand bg-cream/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-cream/60"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <WalletIcon className="h-4 w-4 shrink-0 text-fairway-700" />
          <span className="min-w-0 truncate text-sm font-semibold text-fairway-900">
            {form.displayName || player.name}
          </span>
          {directoryEntry ? (
            <span className="shrink-0 rounded-full bg-fairway-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-700">
              Saved · {directoryEntry.preferredMethod ?? "—"}
            </span>
          ) : hasContact ? (
            <span className="shrink-0 rounded-full border border-sand bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-700/80">
              Unsaved changes
            </span>
          ) : (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-fairway-900/50">
              Not saved
            </span>
          )}
        </span>
        <Chevron open={expanded} />
      </button>

      {expanded ? (
        <div
          id={panelId}
          className="flex flex-col gap-3 border-t border-sand/70 bg-white/70 p-3 sm:p-4"
        >
          <p className="rounded-lg border border-sand bg-cream/30 px-2.5 py-1.5 text-[11px] text-fairway-900/70">
            We never collect bank or card info. Email or phone keeps this
            person linked across future rounds and ledger entries.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput
              label="Display name"
              value={form.displayName}
              onChange={(v) => patch({ displayName: v })}
              placeholder={player.name}
              autoComplete="name"
            />
            <TextInput
              label="Email"
              value={form.email ?? ""}
              onChange={(v) => patch({ email: v })}
              type="email"
              placeholder="name@email.com"
              autoComplete="email"
            />
            <TextInput
              label="Phone"
              value={form.phone ?? ""}
              onChange={(v) => patch({ phone: v })}
              type="tel"
              placeholder="+1 555 123 4567"
              autoComplete="tel"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectInput
              label="Country"
              value={form.country}
              onChange={(v) => patch({ country: v as Country })}
              options={[
                { value: "Canada", label: "Canada" },
                { value: "United States", label: "United States" },
                { value: "Other", label: "Other" },
              ]}
            />
            <SelectInput
              label="Preferred method"
              value={form.preferredMethod}
              onChange={(v) => patch({ preferredMethod: v as PaymentMethod })}
              options={methods.map((m) => ({ value: m, label: m }))}
            />
          </div>

          {showInterac ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="Interac e-Transfer email"
                value={form.interacEmail ?? ""}
                onChange={(v) => patch({ interacEmail: v })}
                type="email"
                placeholder="name@email.com"
                autoComplete="email"
              />
              <TextInput
                label="Interac e-Transfer phone"
                value={form.interacPhone ?? ""}
                onChange={(v) => patch({ interacPhone: v })}
                type="tel"
                placeholder="+1 555 123 4567"
                autoComplete="tel"
              />
            </div>
          ) : null}

          {showVenmo || showCashApp ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {showVenmo ? (
                <TextInput
                  label="Venmo handle"
                  value={form.venmoHandle ?? ""}
                  onChange={(v) => patch({ venmoHandle: v })}
                  placeholder="@yourhandle"
                />
              ) : null}
              {showCashApp ? (
                <TextInput
                  label="Cash App $Cashtag"
                  value={form.cashAppTag ?? ""}
                  onChange={(v) => patch({ cashAppTag: v })}
                  placeholder="$yourtag"
                />
              ) : null}
            </div>
          ) : null}

          {showZelle ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="Zelle email"
                value={form.zelleEmail ?? ""}
                onChange={(v) => patch({ zelleEmail: v })}
                type="email"
                placeholder="name@email.com"
                autoComplete="email"
              />
              <TextInput
                label="Zelle phone"
                value={form.zellePhone ?? ""}
                onChange={(v) => patch({ zellePhone: v })}
                type="tel"
                placeholder="+1 555 123 4567"
                autoComplete="tel"
              />
            </div>
          ) : null}

          <TextInput
            label="PayPal link or email"
            value={form.paypalLink ?? ""}
            onChange={(v) => patch({ paypalLink: v })}
            type="url"
            placeholder="paypal.me/yourname"
            autoComplete="url"
          />

          <TextInput
            label="Notes"
            value={form.notes ?? ""}
            onChange={(v) => patch({ notes: v })}
            placeholder="Alt. handles, preferences, etc."
            multiline
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[11px] text-fairway-900/60">
                Contact key:{" "}
                <span className="font-mono">
                  {normalizeContactKey({
                    email: form.email,
                    phone: form.phone,
                    fallbackId: player.id,
                  })}
                </span>
              </p>
              <SaveStatusPill status={saveStatus} />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus.kind === "saving"}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-fairway-700 px-4 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 disabled:cursor-not-allowed disabled:bg-fairway-700/40"
            >
              {saveStatus.kind === "saving"
                ? "Saving…"
                : "Save Player Settlement Info"}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ---------- Save status pill ---------- */

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "cloud" }
  | { kind: "local" };

function SaveStatusPill({ status }: { status: SaveStatus }) {
  if (status.kind === "idle") return null;
  const palette = SAVE_STATUS_PALETTE[status.kind];
  const label = SAVE_STATUS_LABEL[status.kind];
  const icon = SAVE_STATUS_ICON[status.kind];
  return (
    <span
      className={[
        "inline-flex h-5 w-fit items-center gap-1 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        palette,
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      {icon}
      {label}
    </span>
  );
}

const SAVE_STATUS_LABEL: Record<Exclude<SaveStatus["kind"], "idle">, string> = {
  saving: "Saving…",
  cloud: "Saved to Cloud",
  local: "Local fallback",
};

const SAVE_STATUS_PALETTE: Record<
  Exclude<SaveStatus["kind"], "idle">,
  string
> = {
  saving: "border-sand bg-cream/60 text-fairway-700/80",
  cloud: "border-fairway-600 bg-fairway-700 text-cream",
  local: "border-gold/60 bg-gold/15 text-gold",
};

const SAVE_STATUS_ICON: Record<
  Exclude<SaveStatus["kind"], "idle">,
  React.ReactNode
> = {
  saving: <SpinnerIcon className="h-2.5 w-2.5" />,
  cloud: <CheckIcon className="h-2.5 w-2.5" />,
  local: <CloudOffIcon className="h-2.5 w-2.5" />,
};

/* ---------- Previous unsettled bets ---------- */

function PreviousUnsettledBetsCard({
  players,
  ledger,
  currentRoundCtx,
  contactKeyFor,
  onUpdateStatus,
}: {
  players: Player[];
  ledger: LedgerEntry[];
  currentRoundCtx: ReturnType<typeof currentRoundLedgerContextFromDetails>;
  contactKeyFor: (playerId: string) => string;
  onUpdateStatus: (id: string, status: LedgerStatus) => Promise<void>;
}) {
  const groups = players.map((player) => {
    const contactKey = contactKeyFor(player.id);
    const entries = getPriorUnsettledEntriesForContact(
      ledger,
      contactKey,
      currentRoundCtx,
    );
    const stats = getPlayerLedgerStats(contactKey, entries);
    return { player, contactKey, entries, stats };
  });

  const groupsWithEntries = groups.filter((g) => g.entries.length > 0);
  const totalEntries = groupsWithEntries.reduce(
    (n, g) => n + g.entries.length,
    0,
  );

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-cream/40 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
            Ledger
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
            Previous Unsettled Bets
          </h2>
          <p className="text-xs text-fairway-900/70">
            Pending and disputed debts from earlier rounds, matched by each
            player&apos;s email or phone contact key (Supabase with local
            cache fallback).
          </p>
        </div>
        {totalEntries > 0 ? (
          <span className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-0.5 text-xs font-semibold text-fairway-700">
            {totalEntries}
          </span>
        ) : null}
      </header>

      {groupsWithEntries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sand bg-white/60 px-3 py-4 text-center text-sm text-fairway-900/70">
          No previous unsettled bets found for players in this round.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groupsWithEntries.map(({ player, contactKey, entries, stats }) => (
            <li
              key={player.id}
              className="flex flex-col gap-3 rounded-xl border border-sand bg-white p-3"
            >
              <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-fairway-900">
                    {player.name}
                  </span>
                  <p className="font-mono text-[10px] text-fairway-900/55">
                    {contactKey}
                  </p>
                  {!player.normalizedContactKey ? (
                    <p className="text-[11px] text-gold">
                      Save email or phone above to match cloud ledger rows.
                    </p>
                  ) : null}
                </div>
                <PlayerUnsettledSummary stats={stats} />
              </header>
              <ul className="flex flex-col gap-2">
                {entries.map((entry) => (
                  <PriorUnsettledEntryRow
                    key={entry.id}
                    entry={entry}
                    perspectiveContactKey={contactKey}
                    onUpdateStatus={onUpdateStatus}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlayerUnsettledSummary({
  stats,
}: {
  stats: ReturnType<typeof getPlayerLedgerStats>;
}) {
  const owes = currencyBagToStrings(stats.owes);
  const owed = currencyBagToStrings(stats.owed);
  const net = signedCurrencyBagToStrings(stats.net);

  return (
    <dl className="grid shrink-0 grid-cols-1 gap-1.5 text-right text-[11px] sm:min-w-[12rem]">
      <div className="flex justify-between gap-3 sm:flex-col sm:items-end sm:gap-0.5">
        <dt className="font-semibold uppercase tracking-wider text-fairway-700/70">
          They owe
        </dt>
        <dd className="font-mono tabular-nums text-fairway-900">
          {owes.length ? owes.join(" · ") : "—"}
        </dd>
      </div>
      <div className="flex justify-between gap-3 sm:flex-col sm:items-end sm:gap-0.5">
        <dt className="font-semibold uppercase tracking-wider text-fairway-700/70">
          Owed to them
        </dt>
        <dd className="font-mono tabular-nums text-fairway-900">
          {owed.length ? owed.join(" · ") : "—"}
        </dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-sand/80 pt-1.5 sm:flex-col sm:items-end sm:gap-0.5">
        <dt className="font-semibold uppercase tracking-wider text-fairway-700/70">
          Net outstanding
        </dt>
        <dd className="font-mono font-semibold tabular-nums text-fairway-900">
          {net.length ? net.join(" · ") : "Settled"}
        </dd>
      </div>
    </dl>
  );
}

function PriorUnsettledEntryRow({
  entry,
  perspectiveContactKey,
  onUpdateStatus,
}: {
  entry: LedgerEntry;
  perspectiveContactKey: string;
  onUpdateStatus: (id: string, status: LedgerStatus) => Promise<void>;
}) {
  const meIsPayer = perspectiveContactKey === entry.payerContactKey;
  const perspectiveLine = meIsPayer
    ? `You owe ${entry.receiverName}`
    : `${entry.payerName} owes you`;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-sand bg-cream/30 p-3">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-fairway-900/75">
            {entry.date}
            {entry.courseName ? ` · ${entry.courseName}` : ""}
          </span>
          <span className="text-sm font-semibold text-fairway-900">
            {entry.payerName} pays {entry.receiverName}
          </span>
          <span className="text-xs text-fairway-700/80">{perspectiveLine}</span>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <span className="font-mono text-sm font-semibold tabular-nums text-fairway-900">
            {formatMoneyWithCurrency(entry.amount, entry.currency)}
          </span>
          <StatusChip status={entry.status} />
          {entry.syncState ? (
            <LedgerSyncPill syncState={entry.syncState} />
          ) : null}
        </div>
      </header>
      <LedgerStatusBar
        variant="prior"
        status={entry.status}
        onChange={(next) => void onUpdateStatus(entry.id, next)}
      />
    </li>
  );
}

function currencyBagToStrings(bag: CurrencyBag): string[] {
  const out: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    if (Math.abs(bag[c]) >= 0.005) {
      out.push(formatMoneyWithCurrency(bag[c], c));
    }
  }
  return out;
}

function signedCurrencyBagToStrings(bag: CurrencyBag): string[] {
  const out: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    if (Math.abs(bag[c]) >= 0.005) {
      const sign = bag[c] > 0 ? "+" : "−";
      out.push(`${sign}${formatMoneyWithCurrency(Math.abs(bag[c]), c)}`);
    }
  }
  return out;
}

/* ---------- Send Settlement Notifications ---------- */

function NotificationsCard({
  settlement,
  details,
  playersById,
  directory,
  ledger,
  notifications,
  roundId,
  contactKeyFor,
  pickCurrency,
  nameOf,
  onUpsertNotification,
  onMarkNotificationSent,
}: {
  settlement: SettlementTransaction[];
  details: RoundDetails;
  playersById: Map<string, Player>;
  directory: DirectoryMap;
  ledger: LedgerEntry[];
  notifications: Notification[];
  roundId: string;
  contactKeyFor: (playerId: string) => string;
  pickCurrency: (receiverId: string) => Currency;
  nameOf: (id: string | null | undefined) => string;
  onUpsertNotification: (
    input: NotificationInput & { status: NotificationStatus },
  ) => Notification;
  onMarkNotificationSent: (input: NotificationInput) => Notification;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Notifications
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          Send Settlement Notifications
        </h2>
        <p className="text-xs text-fairway-900/70">
          Generate ready-to-send email or SMS messages for each debtor.
          Golf Bet Ledger never sends anything — copy the text into your own
          mail or messaging app.
        </p>
      </header>

      {settlement.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-4 text-center text-sm text-fairway-900/70">
          No payments needed — nothing to notify.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {settlement.map((t, i) => {
            const receiver = playersById.get(t.toId);
            const payerContactKey = contactKeyFor(t.fromId);
            const receiverContactKey = contactKeyFor(t.toId);
            const payerDirectoryEntry = directory[payerContactKey];
            const currency = pickCurrency(t.toId);
            const instruction: PaymentInstruction = receiver
              ? buildPaymentInstruction(receiver, round2(t.amount), details)
              : {
                  methodLabel: "No payment info on file",
                  destination: null,
                  memo: buildMemo(details),
                  hasProfile: false,
                  hasContact: false,
                };
            const payerStats = getPlayerLedgerStats(payerContactKey, ledger);
            // Pessimistically include the current settlement in the
            // outstanding total so the message stays accurate even if the
            // host hasn't hit "Add to Ledger" yet.
            const outstanding = mergeIntoBag(payerStats.owes, {
              currency,
              amount: round2(t.amount),
              alreadyCounted: !!findDuplicateLedgerEntry(ledger, {
                roundName: details.roundName,
                courseName: details.courseName,
                date: details.date,
                payerContactKey,
                receiverContactKey,
                amount: round2(t.amount),
              }),
            });
            const rowNotifications = notifications.filter(
              (n) =>
                n.roundId === roundId &&
                n.playerContactKey === payerContactKey,
            );
            return (
              <NotificationRow
                key={`${t.fromId}-${t.toId}-${i}`}
                transaction={t}
                payerName={nameOf(t.fromId)}
                receiverName={nameOf(t.toId)}
                payerContactKey={payerContactKey}
                receiverContactKey={receiverContactKey}
                currency={currency}
                details={details}
                instruction={instruction}
                payerDirectoryEntry={payerDirectoryEntry}
                payerOutstanding={outstanding}
                rowNotifications={rowNotifications}
                roundId={roundId}
                onUpsertNotification={onUpsertNotification}
                onMarkNotificationSent={onMarkNotificationSent}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Combine the payer's existing "owes" bag with the current row's amount,
 * skipping the merge if that exact transfer is already represented in the
 * ledger snapshot (otherwise we'd double-count after Add to Ledger).
 */
function mergeIntoBag(
  bag: CurrencyBag,
  extra: { currency: Currency; amount: number; alreadyCounted: boolean },
): CurrencyBag {
  if (extra.alreadyCounted || extra.amount <= 0) return { ...bag };
  return {
    ...bag,
    [extra.currency]: bag[extra.currency] + extra.amount,
  };
}

function NotificationRow({
  transaction,
  payerName,
  receiverName,
  payerContactKey,
  receiverContactKey,
  currency,
  details,
  instruction,
  payerDirectoryEntry,
  payerOutstanding,
  rowNotifications,
  roundId,
  onUpsertNotification,
  onMarkNotificationSent,
}: {
  transaction: SettlementTransaction;
  payerName: string;
  receiverName: string;
  payerContactKey: string;
  receiverContactKey: string;
  currency: Currency;
  details: RoundDetails;
  instruction: PaymentInstruction;
  payerDirectoryEntry: DirectoryEntry | undefined;
  payerOutstanding: CurrencyBag;
  rowNotifications: Notification[];
  roundId: string;
  onUpsertNotification: (
    input: NotificationInput & { status: NotificationStatus },
  ) => Notification;
  onMarkNotificationSent: (input: NotificationInput) => Notification;
}) {
  const recipientEmail = payerDirectoryEntry?.email;
  const recipientPhone = payerDirectoryEntry?.phone;
  const canEmail = !!recipientEmail;
  const canSms = !!recipientPhone;

  const email = useMemo<EmailMessage>(
    () =>
      buildEmailMessage({
        payerName,
        receiverName,
        amount: round2(transaction.amount),
        currency,
        details,
        instruction,
        payerOutstanding,
      }),
    [
      payerName,
      receiverName,
      transaction.amount,
      currency,
      details,
      instruction,
      payerOutstanding,
    ],
  );
  const emailText = useMemo(() => emailToText(email), [email]);
  const sms = useMemo(
    () =>
      buildSmsMessage({
        payerName,
        receiverName,
        amount: round2(transaction.amount),
        currency,
        details,
        instruction,
        payerOutstanding,
      }),
    [
      payerName,
      receiverName,
      transaction.amount,
      currency,
      details,
      instruction,
      payerOutstanding,
    ],
  );

  // The active preview tab. Defaults to the channel we actually have a
  // contact for; falls back to email so the host always sees one preview.
  const initialType: NotificationType | null = canEmail
    ? "email"
    : canSms
      ? "sms"
      : null;
  const [activeType, setActiveType] = useState<NotificationType | null>(
    initialType,
  );
  const [copy, setCopy] = useState<"idle" | "copied" | "error">("idle");

  const baseInput = useMemo<NotificationInput>(
    () => ({
      playerContactKey: payerContactKey,
      roundId,
      type: activeType ?? "email",
      message: "",
      recipientName: payerName,
      recipientContact:
        activeType === "sms" ? recipientPhone : recipientEmail,
      roundName: details.roundName,
      courseName: details.courseName,
      date: details.date,
      amount: round2(transaction.amount),
      currency,
      receiverContactKey,
      receiverName,
    }),
    [
      payerContactKey,
      roundId,
      activeType,
      payerName,
      recipientPhone,
      recipientEmail,
      details.roundName,
      details.courseName,
      details.date,
      transaction.amount,
      currency,
      receiverContactKey,
      receiverName,
    ],
  );

  function handlePreviewEmail() {
    setActiveType("email");
    if (!canEmail) return;
    onUpsertNotification({
      ...baseInput,
      type: "email",
      message: emailText,
      recipientContact: recipientEmail,
      status: "draft",
    });
  }

  function handlePreviewSms() {
    setActiveType("sms");
    if (!canSms) return;
    onUpsertNotification({
      ...baseInput,
      type: "sms",
      message: sms,
      recipientContact: recipientPhone,
      status: "draft",
    });
  }

  async function handleCopy() {
    if (!activeType) return;
    const text = activeType === "email" ? emailText : sms;
    const hasDraftForType = rowNotifications.some(
      (n) => n.status === "draft" && n.type === activeType,
    );
    if (!hasDraftForType) {
      onUpsertNotification({
        ...baseInput,
        type: activeType,
        message: text,
        recipientContact:
          activeType === "sms" ? recipientPhone : recipientEmail,
        status: "draft",
      });
    }
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(text);
        setCopy("copied");
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopy("copied");
      }
    } catch {
      setCopy("error");
    } finally {
      window.setTimeout(() => setCopy("idle"), 2000);
    }
  }

  function handleMarkSent() {
    if (!activeType) return;
    const message = activeType === "email" ? emailText : sms;
    onMarkNotificationSent({
      ...baseInput,
      type: activeType,
      message,
      recipientContact:
        activeType === "sms" ? recipientPhone : recipientEmail,
    });
  }

  const hasSent = rowNotifications.some((n) => n.status === "sent");
  const hasDraft = rowNotifications.some((n) => n.status === "draft");
  const rowStatus: NotificationRowStatus = hasSent
    ? "sent"
    : hasDraft
      ? "draft"
      : "pending";
  const copyLabel =
    copy === "copied"
      ? "Copied!"
      : copy === "error"
        ? "Couldn't copy"
        : "Copy Message";

  return (
    <li className="overflow-hidden rounded-xl border border-sand bg-cream/30">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-fairway-900">
            {payerName} owes {receiverName}{" "}
            <span className="font-mono tabular-nums">
              {formatMoneyWithCurrency(transaction.amount, currency)}
            </span>
          </span>
          <span className="text-[11px] text-fairway-900/70">
            Recipient:{" "}
            <span className="font-mono text-fairway-900">
              {recipientEmail ?? "—"}
            </span>
            {" · "}
            <span className="font-mono text-fairway-900">
              {recipientPhone ?? "—"}
            </span>
          </span>
        </div>
        <NotificationRowBadge status={rowStatus} />
      </header>

      <div className="flex flex-col gap-3 border-t border-sand/70 bg-white/70 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2">
          <TabButton
            label="Preview Email"
            icon={<MailIcon className="h-4 w-4" />}
            active={activeType === "email"}
            disabled={!canEmail}
            disabledLabel="No email on file"
            onClick={handlePreviewEmail}
          />
          <TabButton
            label="Preview SMS"
            icon={<PhoneIcon className="h-4 w-4" />}
            active={activeType === "sms"}
            disabled={!canSms}
            disabledLabel="No phone on file"
            onClick={handlePreviewSms}
          />
        </div>

        {activeType && (activeType === "email" ? canEmail : canSms) ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-sand bg-white p-3 text-xs leading-relaxed text-fairway-900">
            {activeType === "email" ? emailText : sms}
          </pre>
        ) : (
          <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-3 text-center text-xs text-fairway-900/70">
            {!canEmail && !canSms
              ? `No email or phone saved for ${payerName} — add their settlement info above to enable previews.`
              : `No ${activeType === "email" ? "email" : "phone"} saved for ${payerName}. Pick the other channel or add it on the Players page.`}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!activeType || (activeType === "email" ? !canEmail : !canSms)}
            aria-live="polite"
            className={[
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition",
              copy === "copied"
                ? "border-fairway-600 bg-fairway-700 text-cream"
                : "border-sand bg-white text-fairway-800 hover:bg-cream disabled:cursor-not-allowed disabled:bg-cream/40 disabled:text-fairway-900/40",
            ].join(" ")}
          >
            <CopyIcon className="h-4 w-4" />
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={handleMarkSent}
            disabled={!activeType || (activeType === "email" ? !canEmail : !canSms)}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-fairway-700 px-4 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40 sm:ml-auto"
          >
            <CheckIcon className="h-4 w-4" />
            Mark Sent
          </button>
        </div>
      </div>
    </li>
  );
}

function TabButton({
  label,
  icon,
  active,
  disabled,
  disabledLabel,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  disabledLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={[
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
        active
          ? "border-fairway-600 bg-fairway-700 text-cream shadow-sm"
          : "border-sand bg-white text-fairway-800 hover:border-fairway-300 hover:bg-cream",
        disabled
          ? "cursor-not-allowed border-sand bg-cream/40 text-fairway-900/40 hover:border-sand hover:bg-cream/40"
          : "",
      ].join(" ")}
      title={disabled ? disabledLabel : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

type NotificationRowStatus = "sent" | "draft" | "pending";

function NotificationRowBadge({ status }: { status: NotificationRowStatus }) {
  const palette = NOTIFICATION_ROW_PALETTE[status];
  return (
    <span
      className={[
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        palette,
      ].join(" ")}
    >
      {NOTIFICATION_ROW_LABEL[status]}
    </span>
  );
}

const NOTIFICATION_ROW_LABEL: Record<NotificationRowStatus, string> = {
  sent: "Sent",
  draft: "Draft",
  pending: "Pending",
};

const NOTIFICATION_ROW_PALETTE: Record<NotificationRowStatus, string> = {
  sent: "border-fairway-700 bg-fairway-700 text-cream",
  draft: "border-gold bg-gold/15 text-gold",
  pending: "border-sand bg-white text-fairway-900/70",
};

/* ---------- Notification history ---------- */

function NotificationHistoryCard({
  notifications,
  onUpdateStatus,
  syncOutcome,
}: {
  notifications: Notification[];
  onUpdateStatus: (id: string, status: NotificationStatus) => void;
  syncOutcome?: "cloud" | "local" | null;
}) {
  const sorted = useMemo(
    () =>
      [...notifications].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [notifications],
  );
  const sentCount = sorted.filter((n) => n.status === "sent").length;
  const draftCount = sorted.filter((n) => n.status === "draft").length;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-cream/40 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
            History
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
            Notification History
          </h2>
          <p className="text-xs text-fairway-900/70">
            Every settlement email and SMS you&apos;ve previewed or marked as
            sent — across every round.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sorted.length > 0 ? (
            <span className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-0.5 text-xs font-semibold text-fairway-700">
              {sentCount} sent · {draftCount} draft
            </span>
          ) : null}
          {syncOutcome === "local" ? (
            <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-gold/60 bg-gold/15 px-2 text-[10px] font-semibold uppercase tracking-wider text-gold">
              Local fallback
            </span>
          ) : null}
        </div>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sand bg-white/60 px-3 py-4 text-center text-sm text-fairway-900/70">
          No notifications yet. Preview an email or SMS above to start the
          log.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((n) => (
            <NotificationHistoryRow
              key={n.id}
              notification={n}
              onUpdateStatus={onUpdateStatus}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NotificationHistoryRow({
  notification,
  onUpdateStatus,
}: {
  notification: Notification;
  onUpdateStatus: (id: string, status: NotificationStatus) => void;
}) {
  const recipientLabel =
    notification.recipientName ?? notification.playerContactKey;
  const ctx = [
    notification.date,
    notification.courseName,
    notification.roundName,
  ]
    .filter(Boolean)
    .join(" · ");
  const isSent = notification.status === "sent";

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-sand bg-white p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-fairway-900">
            {recipientLabel}
          </span>
          {notification.recipientContact ? (
            <span className="truncate font-mono text-[11px] text-fairway-900/70">
              {notification.recipientContact}
            </span>
          ) : null}
          {ctx ? (
            <span className="truncate text-[11px] text-fairway-900/60">
              {ctx}
            </span>
          ) : null}
          {typeof notification.amount === "number" &&
          notification.currency &&
          notification.receiverName ? (
            <span className="truncate text-[11px] text-fairway-900/70">
              {recipientLabel} owes {notification.receiverName}{" "}
              <span className="font-mono">
                {formatMoneyWithCurrency(
                  notification.amount,
                  notification.currency,
                )}
              </span>
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <NotificationTypePill type={notification.type} />
          <NotificationRowBadge status={notification.status} />
        </div>
      </header>

      <details className="rounded-lg border border-sand bg-cream/30 px-3 py-2 text-xs text-fairway-900/80">
        <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80">
          Message
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fairway-900">
          {notification.message}
        </pre>
      </details>

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-fairway-900/60">
        <span>Logged {formatRelative(notification.createdAt)}</span>
        {notification.updatedAt &&
        notification.updatedAt !== notification.createdAt ? (
          <span>· updated {formatRelative(notification.updatedAt)}</span>
        ) : null}
        <button
          type="button"
          onClick={() =>
            onUpdateStatus(notification.id, isSent ? "draft" : "sent")
          }
          className="ml-auto inline-flex h-7 items-center justify-center gap-1 rounded-full border border-sand bg-white px-2.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-700 transition hover:bg-cream"
        >
          {isSent ? "Mark draft" : "Mark sent"}
        </button>
      </div>
    </li>
  );
}

function NotificationTypePill({ type }: { type: NotificationType }) {
  const isEmail = type === "email";
  return (
    <span
      className={[
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        isEmail
          ? "border-fairway-300 bg-fairway-100 text-fairway-700"
          : "border-gold/40 bg-gold/15 text-gold",
      ].join(" ")}
    >
      {isEmail ? (
        <MailIcon className="h-2.5 w-2.5" />
      ) : (
        <PhoneIcon className="h-2.5 w-2.5" />
      )}
      {type}
    </span>
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  const days = Math.round(diffSec / 86400);
  if (days < 30) return `${days}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ---------- Tiny form primitives shared across the page ---------- */

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80"
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          rows={2}
          className="min-h-[64px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-fairway-900 placeholder:text-fairway-900/40 focus:border-fairway-500 focus:outline-none focus:ring-2 focus:ring-fairway-500/40"
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={
            type === "tel" ? "tel" : type === "email" ? "email" : undefined
          }
          className="h-10 w-full rounded-lg border border-sand bg-white px-3 text-sm text-fairway-900 placeholder:text-fairway-900/40 focus:border-fairway-500 focus:outline-none focus:ring-2 focus:ring-fairway-500/40"
        />
      )}
    </div>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "h-10 w-full appearance-none rounded-lg border border-sand bg-white px-3 pr-9 text-sm text-fairway-900",
          "bg-[length:14px] bg-[right_0.75rem_center] bg-no-repeat",
          "bg-[url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%231c4a23'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e\")]",
          "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
        ].join(" ")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------- Per-player nets ---------- */

function NetTotalsCard({
  players,
  net,
}: {
  players: Player[];
  net: Record<string, number>;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-fairway-700/80">
        Player totals
      </h3>
      <ul className="flex flex-col divide-y divide-sand/60">
        {players.map((p) => {
          const v = net[p.id] ?? 0;
          const positive = v > 0.005;
          const negative = v < -0.005;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
            >
              <span className="text-sm font-medium text-fairway-900">
                {p.name}
              </span>
              <span
                className={[
                  "font-mono text-base font-semibold tabular-nums",
                  positive
                    ? "text-fairway-700"
                    : negative
                      ? "text-flag/90"
                      : "text-fairway-900/60",
                ].join(" ")}
              >
                {positive ? "+" : ""}
                {formatMoney(v)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- Bet breakdown cards ---------- */

function SkinsCard({
  skins,
  players,
  nameOf,
}: {
  skins: SkinsResult;
  players: Player[];
  nameOf: (id: string | null | undefined) => string;
}) {
  const winsByPlayer = players
    .map((p) => ({ player: p, skins: skins.skinsByPlayer[p.id] ?? 0 }))
    .sort((a, b) => b.skins - a.skins);

  return (
    <BreakdownCard
      title="Skins"
      eyebrow={`${formatMoney(skins.amountPerSkin)} per skin`}
    >
      <ul className="flex flex-col divide-y divide-sand/60">
        {winsByPlayer.map(({ player, skins: count }) => {
          const net = skins.perPlayerNet[player.id] ?? 0;
          return (
            <li
              key={player.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="flex items-center gap-2 text-sm">
                <span className="font-medium text-fairway-900">
                  {player.name}
                </span>
                <span className="text-fairway-900/60">
                  · {count} skin{count === 1 ? "" : "s"}
                </span>
              </span>
              <span className={netClass(net)}>
                {net > 0 ? "+" : ""}
                {formatMoney(net)}
              </span>
            </li>
          );
        })}
      </ul>
      {skins.unclaimedCarryover > 0 ? (
        <p className="rounded-xl border border-dashed border-sand-dark/60 bg-cream/60 px-3 py-2 text-xs text-fairway-900/70">
          <span className="font-semibold text-fairway-900">
            Unclaimed carryover:
          </span>{" "}
          {skins.unclaimedCarryover} skin
          {skins.unclaimedCarryover === 1 ? "" : "s"} — the last tie never
          resolved.
        </p>
      ) : null}

      <details className="rounded-xl border border-sand/70 bg-cream/30 px-3 py-2 text-sm text-fairway-900/80">
        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          Hole-by-hole
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {skins.holes.map((h) => (
            <li
              key={h.hole}
              className="flex items-center justify-between gap-3 font-mono text-xs"
            >
              <span className="text-fairway-900/70">Hole {h.hole}</span>
              {h.outcome === "won" ? (
                <span className="text-fairway-900">
                  {nameOf(h.winnerId)} · {h.skinsAwarded} skin
                  {h.skinsAwarded === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="text-fairway-900/60">
                  carryover{h.carryIn > 0 ? ` (${h.carryIn} pending)` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </BreakdownCard>
  );
}

function NassauCard({
  nassau,
  players,
  nameOf,
}: {
  nassau: NassauResult;
  players: Player[];
  nameOf: (id: string | null | undefined) => string;
}) {
  const segments: { key: string; label: string; seg: NassauSegmentResult }[] =
    [];
  if (nassau.front9) segments.push({ key: "front9", label: "Front 9", seg: nassau.front9 });
  if (nassau.back9) segments.push({ key: "back9", label: "Back 9", seg: nassau.back9 });
  if (nassau.total) segments.push({ key: "total", label: "Total", seg: nassau.total });

  return (
    <BreakdownCard title="Nassau" eyebrow={`${segments.length} segment${segments.length === 1 ? "" : "s"}`}>
      <ul className="flex flex-col gap-3">
        {segments.map(({ key, label, seg }) => (
          <li
            key={key}
            className="flex flex-col gap-2 rounded-xl border border-sand bg-cream/30 p-3"
          >
            <header className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-fairway-900">
                {label} · {formatMoney(seg.amount)}
              </span>
              <span
                className={[
                  "text-xs font-semibold uppercase tracking-wider",
                  seg.winnerId
                    ? "text-fairway-700"
                    : "text-fairway-900/60",
                ].join(" ")}
              >
                {seg.winnerId ? `Winner: ${nameOf(seg.winnerId)}` : "Push"}
              </span>
            </header>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {players.map((p) => {
                const total = seg.scoresByPlayer[p.id];
                const isWinner = seg.winnerId === p.id;
                return (
                  <li
                    key={p.id}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono",
                      isWinner
                        ? "border-fairway-300 bg-fairway-100 text-fairway-800"
                        : "border-sand bg-white text-fairway-900/70",
                    ].join(" ")}
                  >
                    <span className="font-sans">{p.name}</span>
                    <span className="tabular-nums">{total}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <ul className="mt-1 flex flex-col divide-y divide-sand/60 border-t border-sand/60 pt-2">
        {players.map((p) => {
          const net = nassau.perPlayerNet[p.id] ?? 0;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between py-2 first:pt-2 last:pb-0"
            >
              <span className="text-sm text-fairway-900">{p.name}</span>
              <span className={netClass(net)}>
                {net > 0 ? "+" : ""}
                {formatMoney(net)}
              </span>
            </li>
          );
        })}
      </ul>
    </BreakdownCard>
  );
}

function TeamMatchCard({
  tm,
  nameOf,
}: {
  tm: TeamMatchResult;
  nameOf: (id: string | null | undefined) => string;
}) {
  const [aA, aB] = tm.teamAPlayerIds;
  const [bA, bB] = tm.teamBPlayerIds;
  const teamAName = `${nameOf(aA)} & ${nameOf(aB)}`;
  const teamBName = `${nameOf(bA)} & ${nameOf(bB)}`;
  const allPlayerIds = [aA, aB, bA, bB];

  const segments: string[] = [];
  if (tm.totalScore) segments.push("Total Score");
  if (tm.skins) segments.push("Team Skins");
  const eyebrow = segments.length ? segments.join(" + ") : "—";

  return (
    <BreakdownCard title="2v2 Team Match" eyebrow={eyebrow}>
      <div className="grid grid-cols-2 gap-2">
        <TeamRosterChip label="Team A" name={teamAName} />
        <TeamRosterChip label="Team B" name={teamBName} />
      </div>

      {tm.totalScore ? (
        <TotalScoreBlock
          totalScore={tm.totalScore}
          teamAName={teamAName}
          teamBName={teamBName}
        />
      ) : null}

      {tm.skins ? (
        <TeamSkinsBlock
          skins={tm.skins}
          teamAName={teamAName}
          teamBName={teamBName}
        />
      ) : null}

      <ul className="mt-1 flex flex-col divide-y divide-sand/60 border-t border-sand/60 pt-2">
        {allPlayerIds.map((id) => {
          const net = tm.perPlayerNet[id] ?? 0;
          const onTeamA = id === aA || id === aB;
          return (
            <li
              key={id}
              className="flex items-center justify-between py-2 first:pt-2 last:pb-0"
            >
              <span className="flex items-center gap-2 text-sm text-fairway-900">
                <span
                  aria-hidden
                  className={[
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wider",
                    onTeamA
                      ? "bg-fairway-100 text-fairway-700"
                      : "bg-gold/15 text-gold",
                  ].join(" ")}
                >
                  {onTeamA ? "A" : "B"}
                </span>
                {nameOf(id)}
              </span>
              <span className={netClass(net)}>
                {net > 0 ? "+" : ""}
                {formatMoney(net)}
              </span>
            </li>
          );
        })}
      </ul>
    </BreakdownCard>
  );
}

function TeamRosterChip({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-sand bg-cream/30 p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80">
        {label}
      </span>
      <span className="text-sm font-semibold text-fairway-900">{name}</span>
    </div>
  );
}

function TotalScoreBlock({
  totalScore,
  teamAName,
  teamBName,
}: {
  totalScore: NonNullable<TeamMatchResult["totalScore"]>;
  teamAName: string;
  teamBName: string;
}) {
  const { winner, teamATotal, teamBTotal, amount } = totalScore;
  const winnerLabel =
    winner === null
      ? "Push"
      : `Winner: ${winner === "A" ? teamAName : teamBName}`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sand bg-cream/30 p-3">
      <header className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-fairway-900">
          Total Score · {formatMoney(amount)}
        </span>
        <span
          className={[
            "text-xs font-semibold uppercase tracking-wider",
            winner ? "text-fairway-700" : "text-fairway-900/60",
          ].join(" ")}
        >
          {winnerLabel}
        </span>
      </header>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <TeamScoreCell
          label={teamAName}
          score={teamATotal}
          highlight={winner === "A"}
        />
        <TeamScoreCell
          label={teamBName}
          score={teamBTotal}
          highlight={winner === "B"}
        />
      </div>
    </div>
  );
}

function TeamScoreCell({
  label,
  score,
  highlight,
}: {
  label: string;
  score: number;
  highlight: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-0.5 rounded-lg border p-2",
        highlight ? "border-fairway-300 bg-fairway-100" : "border-sand bg-white",
      ].join(" ")}
    >
      <span className="truncate px-1 text-[11px] font-medium uppercase tracking-wider text-fairway-700/80">
        {label}
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums text-fairway-900">
        {score}
      </span>
    </div>
  );
}

function TeamSkinsBlock({
  skins,
  teamAName,
  teamBName,
}: {
  skins: NonNullable<TeamMatchResult["skins"]>;
  teamAName: string;
  teamBName: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sand bg-cream/30 p-3">
      <header className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-fairway-900">
          Team Skins · {formatMoney(skins.amount)} / hole
        </span>
        <span className="font-mono text-xs text-fairway-900/70">
          A {skins.skinsByTeam.A} · B {skins.skinsByTeam.B}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <SkinsTeamCell
          label={teamAName}
          count={skins.skinsByTeam.A}
          highlight={skins.skinsByTeam.A > skins.skinsByTeam.B}
        />
        <SkinsTeamCell
          label={teamBName}
          count={skins.skinsByTeam.B}
          highlight={skins.skinsByTeam.B > skins.skinsByTeam.A}
        />
      </div>

      {skins.unclaimedCarryover > 0 ? (
        <p className="rounded-lg border border-dashed border-sand-dark/60 bg-cream/60 px-2 py-1.5 text-xs text-fairway-900/70">
          <span className="font-semibold text-fairway-900">Unclaimed:</span>{" "}
          {skins.unclaimedCarryover} skin
          {skins.unclaimedCarryover === 1 ? "" : "s"} — last tie never
          resolved.
        </p>
      ) : null}

      <details className="rounded-lg border border-sand/70 bg-white px-3 py-2 text-sm text-fairway-900/80">
        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          Hole-by-hole
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {skins.holes.map((h) => (
            <li
              key={h.hole}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 font-mono text-xs"
            >
              <span className="text-fairway-900/70">Hole {h.hole}</span>
              <span className="text-fairway-900/80">
                A {h.teamAScore} · B {h.teamBScore}
              </span>
              {h.outcome === "won" ? (
                <span
                  className={
                    h.winner === "A"
                      ? "text-fairway-700"
                      : "text-gold"
                  }
                >
                  {h.winner} · {h.skinsAwarded} skin
                  {h.skinsAwarded === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="text-fairway-900/60">
                  carryover
                  {h.carryIn > 0 ? ` (${h.carryIn} pending)` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function SkinsTeamCell({
  label,
  count,
  highlight,
}: {
  label: string;
  count: number;
  highlight: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-0.5 rounded-lg border p-2",
        highlight ? "border-fairway-300 bg-fairway-100" : "border-sand bg-white",
      ].join(" ")}
    >
      <span className="truncate px-1 text-[11px] font-medium uppercase tracking-wider text-fairway-700/80">
        {label}
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums text-fairway-900">
        {count} skin{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function StraightMatchCard({
  match,
  nameOf,
}: {
  match: StraightMatchResult;
  nameOf: (id: string | null | undefined) => string;
}) {
  const aName = nameOf(match.playerAId);
  const bName = nameOf(match.playerBId);
  const result =
    match.winnerId === null
      ? "Push"
      : `Winner: ${nameOf(match.winnerId)}`;

  return (
    <BreakdownCard title="Straight Match" eyebrow={formatMoney(match.amount)}>
      <div className="flex flex-col gap-2 rounded-xl border border-sand bg-cream/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-fairway-900">
            {aName} vs {bName}
          </span>
          <span
            className={[
              "text-xs font-semibold uppercase tracking-wider",
              match.winnerId ? "text-fairway-700" : "text-fairway-900/60",
            ].join(" ")}
          >
            {result}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Score name={aName} score={match.scoreA} winner={match.winnerId === match.playerAId} />
          <Score name={bName} score={match.scoreB} winner={match.winnerId === match.playerBId} />
        </div>
      </div>
      <ul className="mt-1 flex flex-col divide-y divide-sand/60 border-t border-sand/60 pt-2">
        {[match.playerAId, match.playerBId].map((id) => {
          const net = match.perPlayerNet[id] ?? 0;
          return (
            <li
              key={id}
              className="flex items-center justify-between py-2 first:pt-2 last:pb-0"
            >
              <span className="text-sm text-fairway-900">{nameOf(id)}</span>
              <span className={netClass(net)}>
                {net > 0 ? "+" : ""}
                {formatMoney(net)}
              </span>
            </li>
          );
        })}
      </ul>
    </BreakdownCard>
  );
}

function Score({
  name,
  score,
  winner,
}: {
  name: string;
  score: number;
  winner: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-0.5 rounded-lg border p-2",
        winner
          ? "border-fairway-300 bg-fairway-100"
          : "border-sand bg-white",
      ].join(" ")}
    >
      <span className="text-[11px] font-medium uppercase tracking-wider text-fairway-700/80">
        {name}
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums text-fairway-900">
        {score}
      </span>
    </div>
  );
}

function ClosestToPinCard({
  ctp,
  players,
  nameOf,
}: {
  ctp: ClosestToPinResult;
  players: Player[];
  nameOf: (id: string | null | undefined) => string;
}) {
  const wonHoles = ctp.holes.filter((h) => h.outcome === "won").length;
  const pushedHoles = ctp.holes.length - wonHoles;

  return (
    <BreakdownCard
      title="Closest to Pin"
      eyebrow={`${ctp.holes.length} hole${ctp.holes.length === 1 ? "" : "s"} · ${wonHoles} won${pushedHoles ? `, ${pushedHoles} pushed` : ""}`}
    >
      <ul className="flex flex-col gap-2">
        {ctp.holes.map((h) => (
          <li
            key={h.hole}
            className={[
              "flex flex-col gap-1 rounded-xl border p-3",
              h.outcome === "won"
                ? "border-fairway-200 bg-fairway-50/60"
                : "border-dashed border-sand-dark/60 bg-cream/60",
            ].join(" ")}
          >
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold">
                  Hole {h.hole}
                </span>
                <span className="text-xs text-fairway-900/70">
                  Pot{" "}
                  <span className="font-semibold text-fairway-900">
                    {formatMoney(
                      h.outcome === "won" ? h.potAwarded : h.holeAmount + h.carryIn,
                    )}
                  </span>
                </span>
              </div>
              {h.outcome === "won" ? (
                <span className="text-xs font-semibold uppercase tracking-wider text-fairway-700">
                  Winner: {nameOf(h.winnerId)}
                </span>
              ) : (
                <span className="text-xs font-semibold uppercase tracking-wider text-fairway-900/60">
                  Push · carries forward
                </span>
              )}
            </header>
            <p className="font-mono text-xs text-fairway-900/70">
              {formatMoney(h.holeAmount)} this hole
              {h.carryIn > 0
                ? ` + ${formatMoney(h.carryIn)} carry-in`
                : ""}
              {h.outcome === "won"
                ? ` → ${formatMoney(h.potAwarded)} awarded`
                : " → rolls to next CTP hole"}
            </p>
          </li>
        ))}
      </ul>

      {ctp.unclaimedCarryover > 0 ? (
        <p className="rounded-xl border border-dashed border-flag/40 bg-flag/[0.05] px-3 py-2 text-xs text-fairway-900/80">
          <span className="font-semibold text-fairway-900">
            Unclaimed Closest to Pin Carryover:
          </span>{" "}
          {formatMoney(ctp.unclaimedCarryover)} — the final CTP hole pushed,
          so the pot stayed in the bag.
        </p>
      ) : null}

      <ul className="mt-1 flex flex-col divide-y divide-sand/60 border-t border-sand/60 pt-2">
        {players.map((p) => {
          const net = ctp.perPlayerNet[p.id] ?? 0;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between py-2 first:pt-2 last:pb-0"
            >
              <span className="text-sm text-fairway-900">{p.name}</span>
              <span className={netClass(net)}>
                {net > 0 ? "+" : ""}
                {formatMoney(net)}
              </span>
            </li>
          );
        })}
      </ul>
    </BreakdownCard>
  );
}

function BreakdownCard({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          {title}
        </h2>
        <span className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          {eyebrow}
        </span>
      </header>
      {children}
    </section>
  );
}

/* ---------- Shell pieces ---------- */

function RoundSummary({ details }: { details: RoundDetails }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-cream/60 p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold tracking-tight text-fairway-900">
            {details.courseName}
          </h2>
          {details.roundName ? (
            <p className="text-sm text-fairway-900/70">{details.roundName}</p>
          ) : null}
        </div>
        <Link
          href="/scorecard"
          className="text-xs font-medium text-fairway-700 underline decoration-fairway-200 underline-offset-4 hover:text-fairway-900"
        >
          Edit scores
        </Link>
      </header>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fairway-900/70">
        <Pair label="Date" value={formatDate(details.date)} />
        <Pair label="Holes" value={`${details.holes}`} />
        <Pair label="Start" value={`Hole ${details.startingHole}`} />
      </dl>
    </section>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1">
      <dt className="font-medium uppercase tracking-wider text-fairway-700/70">
        {label}
      </dt>
      <dd className="font-semibold text-fairway-900">{value}</dd>
    </div>
  );
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-3 z-10 -mx-1 flex items-center gap-2 rounded-full border border-sand/70 bg-background/95 p-2 shadow-[0_8px_28px_-12px_rgba(20,32,26,0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
      {children}
    </div>
  );
}

function EmptyCard({
  title,
  body,
  href,
  label,
}: {
  title: string;
  body: string;
  href: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-6">
      <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-fairway-900/70">{body}</p>
      <Link
        href={href}
        className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-full bg-fairway-700 px-5 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600"
      >
        {label}
      </Link>
    </div>
  );
}

function ViewSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="h-20 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-40 rounded-2xl border border-fairway-200 bg-fairway-50" />
      <div className="h-32 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-32 rounded-2xl border border-sand/70 bg-cream/60" />
    </div>
  );
}

function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function PhoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </svg>
  );
}

function PlusIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function SpinnerIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["animate-spin", className].join(" ")}
      aria-hidden
    >
      <path d="M21 12a9 9 0 11-6.219-8.563" />
    </svg>
  );
}

function CloudOffIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 3l18 18" />
      <path d="M9.7 6.7A5 5 0 0118 9a4 4 0 014 4 4 4 0 01-2 3.5" />
      <path d="M16 17H7a4 4 0 01-3.7-5.6" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[
        "h-3.5 w-3.5 shrink-0 text-fairway-700/80 transition-transform",
        open ? "rotate-180" : "",
      ].join(" ")}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function WalletIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 7h15a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      <path d="M3 7V6a2 2 0 012-2h11" />
      <circle cx="16" cy="13" r="1.25" />
    </svg>
  );
}

/* ---------- Utilities ---------- */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function netClass(v: number): string {
  if (v > 0.005)
    return "font-mono text-base font-semibold tabular-nums text-fairway-700";
  if (v < -0.005)
    return "font-mono text-base font-semibold tabular-nums text-flag/90";
  return "font-mono text-base font-semibold tabular-nums text-fairway-900/60";
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(2)}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function allScoresPresent(
  scores: ScoresMap,
  players: Player[],
  bets: Bets,
  details: RoundDetails,
  ctpWinners: ClosestToPinWinnersMap,
): boolean {
  // We import lazily here to keep the dependency tree light at the top.
  const playOrder = holesInPlayOrderImport(details.holes, details.startingHole);
  for (const h of playOrder) {
    for (const p of players) {
      const s = scores[h]?.[p.id];
      if (typeof s !== "number") return false;
    }
  }
  if (bets.closestToPin.enabled) {
    if (bets.closestToPin.holes.length === 0) return false;
    for (const item of bets.closestToPin.holes) {
      if (!playOrder.includes(item.hole)) return false;
      if (!(item.hole in ctpWinners)) return false;
    }
  }
  return true;
}

// Re-import here to avoid module-load order surprises inside the gate above.
import { holesInPlayOrder as holesInPlayOrderImport } from "@/lib/types";

/* ---------- Summary text for clipboard ---------- */

function formatSummaryText({
  details,
  players,
  results,
  nameOf,
}: {
  details: RoundDetails;
  players: Player[];
  results: BetResults;
  nameOf: (id: string | null | undefined) => string;
}): string {
  const lines: string[] = [];
  const title = details.roundName
    ? `${details.roundName} — ${details.courseName}`
    : details.courseName;
  lines.push(`Golf Bet Ledger — ${title}`);
  lines.push(formatDate(details.date));
  lines.push(`Players: ${players.map((p) => p.name).join(", ")}`);
  lines.push("");
  lines.push("Settlement:");
  if (results.settlement.length === 0) {
    lines.push("• Everyone's settled up — no money changes hands.");
  } else {
    for (const t of results.settlement) {
      lines.push(
        `• ${nameOf(t.fromId)} pays ${nameOf(t.toId)} ${formatMoney(t.amount)}`,
      );
    }
  }
  lines.push("");
  lines.push("Player totals:");
  for (const p of players) {
    const n = results.perPlayerTotalNet[p.id] ?? 0;
    const sign = n > 0 ? "+" : "";
    lines.push(`• ${p.name}: ${sign}${formatMoney(n)}`);
  }

  const betLines: string[] = [];
  if (results.skins) {
    const counts = players
      .map((p) => `${p.name} ${results.skins!.skinsByPlayer[p.id] ?? 0}`)
      .join(", ");
    const carry =
      results.skins.unclaimedCarryover > 0
        ? `, ${results.skins.unclaimedCarryover} unclaimed`
        : "";
    betLines.push(
      `• Skins (${formatMoney(results.skins.amountPerSkin)}/skin) — ${counts}${carry}`,
    );
  }
  if (results.nassau) {
    const segs: string[] = [];
    if (results.nassau.front9) {
      segs.push(
        `Front ${segmentText(results.nassau.front9, nameOf)}`,
      );
    }
    if (results.nassau.back9) {
      segs.push(`Back ${segmentText(results.nassau.back9, nameOf)}`);
    }
    if (results.nassau.total) {
      segs.push(`Total ${segmentText(results.nassau.total, nameOf)}`);
    }
    if (segs.length) betLines.push(`• Nassau — ${segs.join(" · ")}`);
  }
  if (results.teamMatch) {
    const t = results.teamMatch;
    const aName = `${nameOf(t.teamAPlayerIds[0])} & ${nameOf(t.teamAPlayerIds[1])}`;
    const bName = `${nameOf(t.teamBPlayerIds[0])} & ${nameOf(t.teamBPlayerIds[1])}`;
    const pieces: string[] = [];
    if (t.totalScore) {
      const w =
        t.totalScore.winner === null
          ? "push"
          : t.totalScore.winner === "A"
            ? `${aName} wins`
            : `${bName} wins`;
      pieces.push(
        `Total Score (${formatMoney(t.totalScore.amount)}) A ${t.totalScore.teamATotal} vs B ${t.totalScore.teamBTotal} · ${w}`,
      );
    }
    if (t.skins) {
      const carry =
        t.skins.unclaimedCarryover > 0
          ? `, ${t.skins.unclaimedCarryover} unclaimed`
          : "";
      pieces.push(
        `Team Skins (${formatMoney(t.skins.amount)}/hole) A ${t.skins.skinsByTeam.A} · B ${t.skins.skinsByTeam.B}${carry}`,
      );
    }
    betLines.push(
      `• 2v2 Team Match — ${aName} vs ${bName}: ${pieces.join(" · ")}`,
    );
  }
  if (results.straightMatch) {
    const m = results.straightMatch;
    const winner =
      m.winnerId === null
        ? "push"
        : `${nameOf(m.winnerId)} wins ${formatMoney(m.amount)}`;
    betLines.push(
      `• Straight Match — ${nameOf(m.playerAId)} ${m.scoreA} vs ${nameOf(m.playerBId)} ${m.scoreB} · ${winner}`,
    );
  }
  if (results.closestToPin) {
    const c = results.closestToPin;
    const parts = c.holes.map((h) => {
      const pot =
        h.outcome === "won"
          ? formatMoney(h.potAwarded)
          : formatMoney(h.holeAmount + h.carryIn);
      if (h.outcome === "won") {
        return `Hole ${h.hole} (${pot}) → ${nameOf(h.winnerId)}`;
      }
      return `Hole ${h.hole} (${pot}) push → carry`;
    });
    const carryNote =
      c.unclaimedCarryover > 0
        ? `, ${formatMoney(c.unclaimedCarryover)} unclaimed`
        : "";
    betLines.push(`• Closest to Pin — ${parts.join(" · ")}${carryNote}`);
  }
  if (betLines.length) {
    lines.push("");
    lines.push("Bets:");
    lines.push(...betLines);
  }

  lines.push("");
  lines.push("Sent from Golf Bet Ledger");
  return lines.join("\n");
}

function segmentText(
  seg: NassauSegmentResult,
  nameOf: (id: string | null | undefined) => string,
): string {
  if (!seg.winnerId) return `(${formatMoney(seg.amount)}) push`;
  return `(${formatMoney(seg.amount)}) ${nameOf(seg.winnerId)}`;
}
