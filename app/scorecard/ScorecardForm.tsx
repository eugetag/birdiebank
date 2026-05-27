"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHasHydrated } from "@/lib/hooks";
import {
  getDraft,
  setDraftCtpWinners,
  setDraftScores,
} from "@/lib/rounds";
import { RoundSyncPill } from "@/lib/round-sync-pill";
import { syncDraftScores } from "@/lib/scores-service";
import {
  holesInPlayOrder,
  type Bets,
  type ClosestToPinHole,
  type ClosestToPinWinnersMap,
  type Player,
  type RoundDetails,
  type RoundSyncState,
  type ScoresMap,
} from "@/lib/types";

const MIN_SCORE = 1;
const MAX_SCORE = 15;

/* ---------- Scorecard-photo session keys ---------- */
const SS_MODE_KEY = "gbl:scorecard-entry-mode";
const SS_PHOTO_KEY = "gbl:scorecard-photo";
const SS_PHOTO_META_KEY = "gbl:scorecard-photo-meta";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const ACCEPTED_MIMES = ["image/jpeg", "image/png", "image/heic", "image/heif"];
const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"];

type EntryMode = "manual" | "photo";

type PhotoMeta = {
  name: string;
  size: number;
  type: string;
};

export default function ScorecardForm() {
  const hasHydrated = useHasHydrated();

  if (!hasHydrated) {
    return <FormSkeleton />;
  }

  const draft = getDraft();
  if (!draft?.details) {
    return (
      <EmptyCard
        title="No round in progress"
        body="Start with the round details."
        href="/create-round"
        label="Set round details"
      />
    );
  }
  if (!draft.players || draft.players.length < 2) {
    return (
      <EmptyCard
        title="Add players first"
        body="The scorecard needs at least two players."
        href="/players"
        label="Add players"
      />
    );
  }
  if (!draft.bets) {
    return (
      <EmptyCard
        title="Pick your bets first"
        body="Set up the bets before scoring."
        href="/bets"
        label="Set bets"
      />
    );
  }

  return (
    <ScorecardFormInner
      details={draft.details}
      players={draft.players}
      bets={draft.bets}
      initialScores={draft.scores ?? {}}
      initialCtpWinners={draft.closestToPinWinners ?? {}}
      initialScoresSyncState={draft.scoresSyncState}
    />
  );
}

function ScorecardFormInner({
  details,
  players,
  bets,
  initialScores,
  initialCtpWinners,
  initialScoresSyncState,
}: {
  details: RoundDetails;
  players: Player[];
  bets: Bets;
  initialScores: ScoresMap;
  initialCtpWinners: ClosestToPinWinnersMap;
  initialScoresSyncState?: RoundSyncState;
}) {
  const router = useRouter();
  const [scoresSyncState, setScoresSyncState] = useState<
    RoundSyncState | undefined
  >(initialScoresSyncState);
  const [continuing, setContinuing] = useState(false);

  const holes = useMemo(
    () => holesInPlayOrder(details.holes, details.startingHole),
    [details.holes, details.startingHole],
  );

  const ctpItems = useMemo<ClosestToPinHole[]>(
    () =>
      bets.closestToPin.enabled
        ? [...bets.closestToPin.holes]
            .filter((h) => holes.includes(h.hole))
            .sort((a, b) => a.hole - b.hole)
        : [],
    [bets.closestToPin, holes],
  );
  const ctpByHole = useMemo(() => {
    const m = new Map<number, ClosestToPinHole>();
    for (const i of ctpItems) m.set(i.hole, i);
    return m;
  }, [ctpItems]);

  const [scores, setScores] = useState<ScoresMap>(() =>
    buildInitialScores(holes, players, initialScores),
  );
  // Raw winners map — may contain stale entries for holes that are no longer
  // CTP holes. We always filter through `effectiveCtpWinners` before using.
  const [ctpWinnersRaw, setCtpWinnersRaw] =
    useState<ClosestToPinWinnersMap>(() => ({ ...initialCtpWinners }));
  const [attempted, setAttempted] = useState(false);

  // ---- Scorecard photo (session-only) ----
  const [entryMode, setEntryMode] = useState<EntryMode>(
    () => (readSession(SS_MODE_KEY) === "photo" ? "photo" : "manual"),
  );
  const [scorecardPhoto, setScorecardPhoto] = useState<string | null>(() =>
    readSession(SS_PHOTO_KEY),
  );
  const [photoMeta, setPhotoMeta] = useState<PhotoMeta | null>(() => {
    const raw = readSession(SS_PHOTO_META_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PhotoMeta;
      if (
        parsed &&
        typeof parsed.name === "string" &&
        typeof parsed.size === "number" &&
        typeof parsed.type === "string"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [extractedScores, setExtractedScores] = useState<ScoresMap | null>(
    null,
  );
  const [appliedNotice, setAppliedNotice] = useState(false);

  const effectiveCtpWinners = useMemo(
    () => filterCtpWinners(ctpWinnersRaw, ctpItems),
    [ctpWinnersRaw, ctpItems],
  );

  // Auto-save scores to localStorage on every change.
  useEffect(() => {
    setDraftScores(scores);
  }, [scores]);

  // Auto-save the cleaned CTP winners map. Stale picks (for holes that were
  // removed in /bets) are dropped at the boundary.
  useEffect(() => {
    setDraftCtpWinners(effectiveCtpWinners);
  }, [effectiveCtpWinners]);

  // Persist entry mode + photo to sessionStorage so a refresh during the
  // round doesn't lose them. Photos never touch localStorage (size cap).
  useEffect(() => {
    writeSession(SS_MODE_KEY, entryMode);
  }, [entryMode]);
  useEffect(() => {
    writeSession(SS_PHOTO_KEY, scorecardPhoto);
  }, [scorecardPhoto]);
  useEffect(() => {
    writeSession(
      SS_PHOTO_META_KEY,
      photoMeta ? JSON.stringify(photoMeta) : null,
    );
  }, [photoMeta]);

  function handlePhotoSelect(dataUrl: string, meta: PhotoMeta) {
    setScorecardPhoto(dataUrl);
    setPhotoMeta(meta);
    setExtractedScores(null);
  }

  function handleClearPhoto() {
    setScorecardPhoto(null);
    setPhotoMeta(null);
    setExtractedScores(null);
  }

  function handleEntryMode(next: EntryMode) {
    setEntryMode(next);
    if (next === "manual") setExtractedScores(null);
  }

  function handleAnalyze() {
    setExtractedScores(generateMockExtractedScores(holes, players));
    setAppliedNotice(false);
  }

  function handleEditExtracted(
    hole: number,
    playerId: string,
    value: number | null,
  ) {
    setExtractedScores((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [hole]: { ...(prev[hole] ?? {}), [playerId]: value },
      };
    });
  }

  function handleApplyExtracted() {
    if (!extractedScores) return;
    setScores(extractedScores);
    setExtractedScores(null);
    setAppliedNotice(true);
  }

  function handleDiscardExtracted() {
    setExtractedScores(null);
  }

  function updateScore(hole: number, playerId: string, value: number | null) {
    setScores((prev) => ({
      ...prev,
      [hole]: { ...(prev[hole] ?? {}), [playerId]: value },
    }));
  }

  function updateCtpWinner(hole: number, value: string | "push" | null) {
    setCtpWinnersRaw((prev) => {
      const next = { ...prev };
      if (value === null) {
        delete next[hole];
      } else {
        next[hole] = value;
      }
      return next;
    });
  }

  const incompleteHoles = useMemo(() => {
    const missing: number[] = [];
    for (const hole of holes) {
      const row = scores[hole] ?? {};
      const allFilled = players.every((p) => {
        const s = row[p.id];
        return typeof s === "number" && s >= MIN_SCORE && s <= MAX_SCORE;
      });
      if (!allFilled) missing.push(hole);
    }
    return missing;
  }, [scores, holes, players]);

  const ctpMissingHoles = useMemo(() => {
    if (!bets.closestToPin.enabled) return [];
    return ctpItems
      .map((i) => i.hole)
      .filter((h) => !(h in effectiveCtpWinners));
  }, [bets.closestToPin.enabled, ctpItems, effectiveCtpWinners]);

  const completedCount = holes.length - incompleteHoles.length;
  const ctpTotal = ctpItems.length;
  const ctpDone = ctpTotal - ctpMissingHoles.length;
  const canContinue =
    incompleteHoles.length === 0 && ctpMissingHoles.length === 0;

  async function handleContinue() {
    if (!canContinue) {
      setAttempted(true);
      scrollToFirstIssue(incompleteHoles, ctpMissingHoles);
      return;
    }
    if (continuing) return;

    setDraftScores(scores);
    setDraftCtpWinners(effectiveCtpWinners);
    setContinuing(true);
    try {
      const result = await syncDraftScores(scores, players);
      setScoresSyncState(result.outcome);
      router.push("/results");
    } finally {
      setContinuing(false);
    }
  }

  function handleBack() {
    router.push("/bets");
  }

  return (
    <div className="flex flex-col gap-6">
      <RoundSummary details={details} />

      <EntryModeCard mode={entryMode} onChange={handleEntryMode} />

      {entryMode === "photo" ? (
        <PhotoSection
          photo={scorecardPhoto}
          meta={photoMeta}
          onSelect={handlePhotoSelect}
          onClear={handleClearPhoto}
          onAnalyze={handleAnalyze}
          onSwitchToManual={() => handleEntryMode("manual")}
        />
      ) : null}

      {extractedScores ? (
        <ExtractedReviewCard
          extracted={extractedScores}
          holes={holes}
          players={players}
          onEdit={handleEditExtracted}
          onApply={handleApplyExtracted}
          onDiscard={handleDiscardExtracted}
        />
      ) : null}

      {appliedNotice ? (
        <AppliedNoticeBanner onDismiss={() => setAppliedNotice(false)} />
      ) : null}

      <ProgressCard
        completed={completedCount}
        total={holes.length}
        ctpTotal={ctpTotal}
        ctpDone={ctpDone}
        scoresSyncState={scoresSyncState}
      />

      <section className="flex flex-col gap-3">
        {holes.map((hole) => {
          const ctpItem = ctpByHole.get(hole);
          return (
            <HoleCard
              key={hole}
              hole={hole}
              players={players}
              row={scores[hole] ?? {}}
              onChange={(playerId, value) => updateScore(hole, playerId, value)}
              highlightMissing={attempted && incompleteHoles.includes(hole)}
              ctpItem={ctpItem}
              ctpWinner={ctpItem ? (effectiveCtpWinners[hole] ?? null) : null}
              onCtpChange={(v) => updateCtpWinner(hole, v)}
              highlightCtpMissing={
                attempted && ctpMissingHoles.includes(hole)
              }
            />
          );
        })}
      </section>

      <Totals holes={holes} players={players} scores={scores} />

      <ActionBar>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-12 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:h-11"
        >
          Back to Bets
        </button>
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={(attempted && !canContinue) || continuing}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-fairway-700 px-6 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40 sm:h-11 sm:flex-none"
        >
          {continuing ? "Saving scores…" : "Continue to Results"}
          {!continuing ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </ActionBar>

      {attempted && !canContinue ? (
        <ErrorBanner
          incompleteHoles={incompleteHoles}
          ctpMissingHoles={ctpMissingHoles}
        />
      ) : null}
    </div>
  );
}

function filterCtpWinners(
  saved: ClosestToPinWinnersMap,
  ctpItems: ClosestToPinHole[],
): ClosestToPinWinnersMap {
  const allowed = new Set(ctpItems.map((i) => i.hole));
  const next: ClosestToPinWinnersMap = {};
  for (const [k, v] of Object.entries(saved)) {
    const hole = Number(k);
    if (allowed.has(hole)) next[hole] = v;
  }
  return next;
}

/* ---------- Per-hole UI ---------- */

function HoleCard({
  hole,
  players,
  row,
  onChange,
  highlightMissing,
  ctpItem,
  ctpWinner,
  onCtpChange,
  highlightCtpMissing,
}: {
  hole: number;
  players: Player[];
  row: Record<string, number | null>;
  onChange: (playerId: string, value: number | null) => void;
  highlightMissing: boolean;
  ctpItem: ClosestToPinHole | undefined;
  ctpWinner: string | "push" | null;
  onCtpChange: (value: string | "push" | null) => void;
  highlightCtpMissing: boolean;
}) {
  const playerCount = players.length;
  const gridColsClass =
    playerCount <= 2
      ? "grid-cols-2"
      : playerCount === 3
        ? "grid-cols-3"
        : "grid-cols-2 sm:grid-cols-4";

  return (
    <section
      id={holeAnchor(hole)}
      className={[
        "flex scroll-mt-24 flex-col gap-3 rounded-2xl border bg-white p-4 transition sm:p-5",
        highlightMissing
          ? "border-flag/60 bg-flag/[0.03]"
          : "border-sand/70",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 min-w-8 items-center justify-center rounded-full bg-fairway-700 px-2 font-mono text-sm font-semibold text-cream"
          >
            {hole}
          </span>
          <span className="text-sm font-semibold tracking-tight text-fairway-900">
            Hole {hole}
          </span>
        </div>
        {ctpItem ? (
          <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold">
            CTP · {formatMoney(ctpItem.amount)}
          </span>
        ) : null}
      </header>

      <ul className={`grid gap-2.5 ${gridColsClass}`}>
        {players.map((p) => (
          <li key={p.id}>
            <PlayerScoreInput
              hole={hole}
              player={p}
              value={row[p.id] ?? null}
              onChange={(v) => onChange(p.id, v)}
            />
          </li>
        ))}
      </ul>

      {ctpItem ? (
        <ClosestToPinPicker
          players={players}
          ctpAmount={ctpItem.amount}
          value={ctpWinner}
          onChange={onCtpChange}
          highlightMissing={highlightCtpMissing}
        />
      ) : null}
    </section>
  );
}

function PlayerScoreInput({
  hole,
  player,
  value,
  onChange,
}: {
  hole: number;
  player: Player;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const inputId = useId();
  return (
    <label
      htmlFor={inputId}
      className="flex flex-col items-stretch gap-1 rounded-xl border border-sand bg-cream/30 p-2 transition focus-within:border-fairway-500 focus-within:bg-white"
    >
      <span className="truncate px-1 text-[11px] font-medium uppercase tracking-wider text-fairway-700/80">
        {player.name}
      </span>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={2}
        enterKeyHint="next"
        aria-label={`Score for ${player.name} on hole ${hole}`}
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/\D/g, "").slice(0, 2);
          if (cleaned === "") {
            onChange(null);
            return;
          }
          const n = Number(cleaned);
          onChange(Number.isFinite(n) ? n : null);
        }}
        onFocus={(e) => e.currentTarget.select()}
        className="h-12 w-full rounded-lg bg-white text-center font-mono text-xl font-semibold tabular-nums text-fairway-900 placeholder:text-fairway-900/30 focus:outline-none"
        placeholder="—"
      />
    </label>
  );
}

function ClosestToPinPicker({
  players,
  ctpAmount,
  value,
  onChange,
  highlightMissing,
}: {
  players: Player[];
  ctpAmount: number;
  value: string | "push" | null;
  onChange: (value: string | "push" | null) => void;
  highlightMissing: boolean;
}) {
  const selectId = useId();
  return (
    <div
      className={[
        "flex flex-col gap-1.5 rounded-xl border bg-cream/40 p-3 transition",
        highlightMissing ? "border-flag/60" : "border-sand/80",
      ].join(" ")}
    >
      <label
        htmlFor={selectId}
        className="text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80"
      >
        Closest to pin · {formatMoney(ctpAmount)}
      </label>
      <select
        id={selectId}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange(null);
          else if (v === "push") onChange("push");
          else onChange(v);
        }}
        className={[
          "h-11 w-full appearance-none rounded-lg border bg-white px-3 pr-9 text-base text-fairway-900",
          "bg-[length:14px] bg-[right_0.875rem_center] bg-no-repeat",
          "bg-[url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%231c4a23'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e\")]",
          "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
          highlightMissing ? "border-flag/60" : "border-sand",
        ].join(" ")}
      >
        <option value="">Pick winner…</option>
        <option value="push">Push / Tie / No winner</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {value === "push" ? (
        <p className="text-xs text-fairway-900/60">
          Pot carries to the next Closest to Pin hole.
        </p>
      ) : null}
    </div>
  );
}

function Totals({
  holes,
  players,
  scores,
}: {
  holes: number[];
  players: Player[];
  scores: ScoresMap;
}) {
  const totals = players.map((p) => {
    let total = 0;
    let counted = 0;
    for (const h of holes) {
      const s = scores[h]?.[p.id];
      if (typeof s === "number") {
        total += s;
        counted += 1;
      }
    }
    return { player: p, total, counted };
  });

  const playerCount = players.length;
  const gridColsClass =
    playerCount <= 2
      ? "grid-cols-2"
      : playerCount === 3
        ? "grid-cols-3"
        : "grid-cols-2 sm:grid-cols-4";

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fairway-700/80">
          Running totals
        </h2>
        <span className="text-xs text-fairway-900/60">
          Holes scored: {Math.max(...totals.map((t) => t.counted), 0)} / {holes.length}
        </span>
      </header>
      <ul className={`grid gap-2 ${gridColsClass}`}>
        {totals.map(({ player, total, counted }) => (
          <li
            key={player.id}
            className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-sand bg-cream/30 p-3"
          >
            <span className="truncate px-1 text-[11px] font-medium uppercase tracking-wider text-fairway-700/80">
              {player.name}
            </span>
            <span className="font-mono text-xl font-semibold tabular-nums text-fairway-900">
              {counted === 0 ? "—" : total}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgressCard({
  completed,
  total,
  ctpTotal,
  ctpDone,
  scoresSyncState,
}: {
  completed: number;
  total: number;
  ctpTotal: number;
  ctpDone: number;
  scoresSyncState?: RoundSyncState;
}) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-sand/70 bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-fairway-900">
          Progress
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {scoresSyncState ? (
            <RoundSyncPill
              state={scoresSyncState}
              cloudLabel="Scores saved to cloud"
            />
          ) : null}
          <span className="font-mono text-sm font-semibold text-fairway-900">
            {completed} / {total}
          </span>
        </div>
      </header>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-cream"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label={`${completed} of ${total} holes scored`}
      >
        <div
          className="h-full rounded-full bg-fairway-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {ctpTotal > 0 ? (
        <p className="text-xs text-fairway-900/60">
          Closest to pin: {ctpDone} / {ctpTotal} resolved
          {ctpDone < ctpTotal
            ? " — pick a winner (or Push) for each CTP hole."
            : "."}
        </p>
      ) : null}
    </section>
  );
}

function ErrorBanner({
  incompleteHoles,
  ctpMissingHoles,
}: {
  incompleteHoles: number[];
  ctpMissingHoles: number[];
}) {
  const list = incompleteHoles.slice(0, 4).map((h) => `Hole ${h}`).join(", ");
  const more =
    incompleteHoles.length > 4 ? `, +${incompleteHoles.length - 4} more` : "";
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-flag/40 bg-flag/[0.05] p-4 text-sm text-fairway-900"
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-flag/15 text-flag"
      >
        !
      </span>
      <div className="flex flex-col gap-1.5">
        {incompleteHoles.length > 0 ? (
          <>
            <p className="font-semibold">
              Add scores for {incompleteHoles.length}{" "}
              {incompleteHoles.length === 1 ? "hole" : "holes"} before
              continuing.
            </p>
            <p className="text-fairway-900/70">
              Missing: {list}
              {more}
            </p>
          </>
        ) : null}
        {ctpMissingHoles.length > 0 ? (
          <p className="text-fairway-900/80">
            Pick a Closest to Pin winner (or Push) on{" "}
            {ctpMissingHoles.map((h, i) => (
              <span key={h}>
                {i > 0 ? ", " : ""}
                <a
                  href={`#${holeAnchor(h)}`}
                  className="font-medium text-fairway-700 underline decoration-fairway-200 underline-offset-4 hover:text-fairway-900"
                >
                  Hole {h}
                </a>
              </span>
            ))}
            .
          </p>
        ) : null}
      </div>
    </div>
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
          href="/bets"
          className="text-xs font-medium text-fairway-700 underline decoration-fairway-200 underline-offset-4 hover:text-fairway-900"
        >
          Edit bets
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

function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="h-20 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-24 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-16 rounded-2xl border border-sand/70 bg-cream/60" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-28 rounded-2xl border border-sand/70 bg-cream/60"
        />
      ))}
    </div>
  );
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

/* ---------- Utilities ---------- */

function holeAnchor(hole: number): string {
  return `hole-${hole}`;
}

function scrollToFirstIssue(
  incompleteHoles: number[],
  ctpMissingHoles: number[],
): void {
  const target = incompleteHoles[0] ?? ctpMissingHoles[0] ?? null;
  if (target == null || typeof document === "undefined") return;
  const el = document.getElementById(holeAnchor(target));
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function buildInitialScores(
  holes: number[],
  players: Player[],
  saved: ScoresMap,
): ScoresMap {
  const out: ScoresMap = {};
  for (const hole of holes) {
    const row: Record<string, number | null> = {};
    for (const p of players) {
      const existing = saved[hole]?.[p.id];
      row[p.id] = typeof existing === "number" ? existing : null;
    }
    out[hole] = row;
  }
  return out;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- Session storage helpers ---------- */

function readSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Most commonly QuotaExceededError when the data URL is huge.
    // The photo still lives in React state for this page session.
  }
}

/* ---------- Entry mode + photo UI ---------- */

function EntryModeCard({
  mode,
  onChange,
}: {
  mode: EntryMode;
  onChange: (next: EntryMode) => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-4 sm:p-5">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold tracking-tight text-fairway-900">
          How do you want to enter scores?
        </h2>
        <p className="text-xs text-fairway-900/60">
          You can switch any time — your typed scores aren&apos;t lost.
        </p>
      </header>
      <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ModeOption
          active={mode === "manual"}
          onClick={() => onChange("manual")}
          icon={<KeyboardIcon className="h-5 w-5" />}
          title="Manual entry"
          subtitle="Type each player&apos;s score by hole"
        />
        <ModeOption
          active={mode === "photo"}
          onClick={() => onChange("photo")}
          icon={<CameraIcon className="h-5 w-5" />}
          title="Upload scorecard photo"
          subtitle="Snap or upload the paper card"
        />
      </div>
    </section>
  );
}

function ModeOption({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={[
        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition",
        "focus:outline-none focus:ring-2 focus:ring-fairway-500/40",
        active
          ? "border-fairway-500 bg-fairway-50 shadow-[0_1px_0_rgba(20,32,26,0.04)]"
          : "border-sand bg-white hover:bg-cream",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          active
            ? "bg-fairway-700 text-cream"
            : "bg-cream text-fairway-700",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={[
            "text-sm font-semibold",
            active ? "text-fairway-900" : "text-fairway-900/90",
          ].join(" ")}
        >
          {title}
        </span>
        <span className="truncate text-xs text-fairway-900/60">{subtitle}</span>
      </span>
    </button>
  );
}

function PhotoSection({
  photo,
  meta,
  onSelect,
  onClear,
  onAnalyze,
  onSwitchToManual,
}: {
  photo: string | null;
  meta: PhotoMeta | null;
  onSelect: (dataUrl: string, meta: PhotoMeta) => void;
  onClear: () => void;
  onAnalyze: () => void;
  onSwitchToManual: () => void;
}) {
  return photo ? (
    <PhotoPreview
      photo={photo}
      meta={meta}
      onClear={onClear}
      onAnalyze={onAnalyze}
      onSwitchToManual={onSwitchToManual}
    />
  ) : (
    <PhotoDropzone onSelect={onSelect} onSwitchToManual={onSwitchToManual} />
  );
}

function PhotoDropzone({
  onSelect,
  onSwitchToManual,
}: {
  onSelect: (dataUrl: string, meta: PhotoMeta) => void;
  onSwitchToManual: () => void;
}) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (!isAcceptedImage(file)) {
      setError(
        "Please choose a JPG, PNG, or HEIC photo of your scorecard.",
      );
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError(
        `That photo is ${formatBytes(file.size)} — please keep it under ${formatBytes(MAX_PHOTO_BYTES)}.`,
      );
      return;
    }
    setError(null);
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null;
      if (!url) {
        setReading(false);
        setError("Couldn't read that file. Try another image.");
        return;
      }
      onSelect(url, {
        name: file.name,
        size: file.size,
        type: file.type || "image/jpeg",
      });
      setReading(false);
    };
    reader.onerror = () => {
      setReading(false);
      setError("Couldn't read that file. Try another image.");
    };
    reader.readAsDataURL(file);
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-4 sm:p-5">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold tracking-tight text-fairway-900">
          Upload scorecard photo
        </h2>
        <p className="text-xs text-fairway-900/60">
          We&apos;ll keep this photo on this device only.
        </p>
      </header>

      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
          dragOver
            ? "border-fairway-500 bg-fairway-50"
            : "border-sand-dark/70 bg-cream/40 hover:bg-cream",
        ].join(" ")}
      >
        <UploadCloudIcon className="h-10 w-10 text-fairway-700/70" />
        <span className="text-sm font-semibold text-fairway-900">
          {reading ? "Reading photo…" : "Tap to choose a photo"}
        </span>
        <span className="text-xs text-fairway-900/60">
          or drag &amp; drop · JPG · PNG · HEIC up to {formatBytes(MAX_PHOTO_BYTES)}
        </span>
        <input
          id={inputId}
          type="file"
          accept={`${ACCEPTED_MIMES.join(",")},${ACCEPTED_EXTENSIONS.join(",")}`}
          className="sr-only"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            // Allow re-selecting the same file later if the user removes it.
            e.target.value = "";
          }}
        />
      </label>

      {error ? <p className="text-sm text-flag">{error}</p> : null}

      <button
        type="button"
        onClick={onSwitchToManual}
        className="self-center text-xs font-medium text-fairway-700 underline decoration-fairway-200 underline-offset-4 hover:text-fairway-900"
      >
        Or enter scores manually instead
      </button>
    </section>
  );
}

function PhotoPreview({
  photo,
  meta,
  onClear,
  onAnalyze,
  onSwitchToManual,
}: {
  photo: string;
  meta: PhotoMeta | null;
  onClear: () => void;
  onAnalyze: () => void;
  onSwitchToManual: () => void;
}) {
  const [previewBroken, setPreviewBroken] = useState(false);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-4 sm:p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-fairway-900">
            Scorecard photo
          </h2>
          {meta ? (
            <p className="truncate text-xs text-fairway-900/60">
              {meta.name} · {formatBytes(meta.size)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-sand bg-white px-3 text-xs font-medium text-flag/90 transition hover:bg-flag/[0.06]"
        >
          Remove
        </button>
      </header>

      <div className="flex items-center justify-center rounded-xl border border-sand bg-cream/30 p-2">
        {previewBroken ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <ImageOffIcon className="h-8 w-8 text-fairway-700/60" />
            <p className="text-sm font-semibold text-fairway-900">
              Preview not supported
            </p>
            <p className="max-w-xs text-xs text-fairway-900/60">
              Your browser can&apos;t display this image format. We&apos;ll
              still be able to analyze it later.
            </p>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt="Uploaded scorecard"
            className="max-h-[28rem] w-auto rounded-lg object-contain"
            onError={() => setPreviewBroken(true)}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onAnalyze}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-fairway-700 px-5 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99]"
        >
          <SparkleIcon className="h-4 w-4" />
          Analyze Scorecard
        </button>
        <button
          type="button"
          onClick={onSwitchToManual}
          className="inline-flex h-11 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream"
        >
          Enter Manually Instead
        </button>
      </div>
    </section>
  );
}

/* ---------- Mock AI extraction review ---------- */

/**
 * Build a complete `ScoresMap` filled with random scores in [3, 7] for every
 * (hole, player) pair. Used as a placeholder while we wire real OCR later.
 */
function generateMockExtractedScores(
  holes: number[],
  players: Player[],
): ScoresMap {
  const out: ScoresMap = {};
  for (const hole of holes) {
    const row: Record<string, number | null> = {};
    for (const p of players) {
      row[p.id] = 3 + Math.floor(Math.random() * 5);
    }
    out[hole] = row;
  }
  return out;
}

function ExtractedReviewCard({
  extracted,
  holes,
  players,
  onEdit,
  onApply,
  onDiscard,
}: {
  extracted: ScoresMap;
  holes: number[];
  players: Player[];
  onEdit: (hole: number, playerId: string, value: number | null) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-fairway-200 bg-white p-4 sm:p-5">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Mock extraction
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          Review Extracted Scores
        </h2>
        <p className="text-xs text-fairway-900/70">
          We&apos;ve pre-filled placeholder scores from your photo. Edit any
          cell, then apply them to the scorecard below. Real OCR lands in the
          next phase.
        </p>
      </header>

      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[18rem] border-separate border-spacing-x-1.5 border-spacing-y-1">
          <thead>
            <tr>
              <th
                scope="col"
                className="px-1 text-left text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80"
              >
                Hole
              </th>
              {players.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  className="px-1 text-center text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80"
                >
                  <span className="block truncate" title={p.name}>
                    {p.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holes.map((hole) => (
              <tr key={hole}>
                <th
                  scope="row"
                  className="w-10 rounded-lg bg-cream/50 px-1 text-center font-mono text-sm font-semibold text-fairway-900"
                >
                  {hole}
                </th>
                {players.map((p) => (
                  <td key={p.id} className="align-middle">
                    <ExtractedScoreCell
                      hole={hole}
                      player={p}
                      value={extracted[hole]?.[p.id] ?? null}
                      onChange={(v) => onEdit(hole, p.id, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onApply}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-fairway-700 px-5 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99]"
        >
          Apply Scores to Scorecard
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex h-11 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream"
        >
          Discard and Enter Manually
        </button>
      </div>
    </section>
  );
}

function ExtractedScoreCell({
  hole,
  player,
  value,
  onChange,
}: {
  hole: number;
  player: Player;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      maxLength={2}
      enterKeyHint="next"
      aria-label={`Extracted score for ${player.name} on hole ${hole}`}
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/\D/g, "").slice(0, 2);
        if (cleaned === "") {
          onChange(null);
          return;
        }
        const n = Number(cleaned);
        onChange(Number.isFinite(n) ? n : null);
      }}
      onFocus={(e) => e.currentTarget.select()}
      className="h-10 w-full min-w-12 rounded-lg border border-sand bg-white text-center font-mono text-base font-semibold tabular-nums text-fairway-900 placeholder:text-fairway-900/30 transition focus:border-fairway-500 focus:outline-none focus:ring-2 focus:ring-fairway-500/40"
      placeholder="—"
    />
  );
}

function AppliedNoticeBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-fairway-200 bg-fairway-50 p-3 text-sm text-fairway-900 sm:p-4"
    >
      <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-fairway-700" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-semibold">Scores applied.</p>
        <p className="text-fairway-900/75">
          Please review before calculating results.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fairway-700/60 transition hover:bg-fairway-100 hover:text-fairway-900"
      >
        <span aria-hidden className="text-lg leading-none">
          ×
        </span>
      </button>
    </div>
  );
}

function CheckCircleIcon({ className = "" }: { className?: string }) {
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
      <circle cx="12" cy="12" r="9.5" />
      <path d="M8 12.5l2.75 2.75L16 9.75" />
    </svg>
  );
}

function isAcceptedImage(file: File): boolean {
  const name = file.name.toLowerCase();
  if (ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (ACCEPTED_MIMES.includes(file.type)) return true;
  // Some browsers report an empty MIME type for HEIC; fall back to extension.
  return false;
}

function KeyboardIcon({ className = "" }: { className?: string }) {
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
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </svg>
  );
}

function CameraIcon({ className = "" }: { className?: string }) {
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
      <path d="M4 8h3l2-2h6l2 2h3a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 012-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function UploadCloudIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7 18a4 4 0 01-1-7.87A6 6 0 0118 8a4.5 4.5 0 01.5 8.97" />
      <path d="M12 12v8" />
      <path d="M9 15l3-3 3 3" />
    </svg>
  );
}

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2zm6 10l.9 2.5L21 15l-2.1.5L18 18l-.9-2.5L15 15l2.1-.5L18 12zM5 14l.7 1.8L7.5 16.5 5.7 17.2 5 19l-.7-1.8L2.5 16.5l1.8-.7L5 14z" />
    </svg>
  );
}

function ImageOffIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 3l18 18" />
      <path d="M21 15V7a2 2 0 00-2-2H8" />
      <path d="M3.5 5.5A2 2 0 003 7v10a2 2 0 002 2h12.5" />
      <path d="M16 9l5 6" />
      <path d="M5 19l5-5 3 3" />
    </svg>
  );
}
