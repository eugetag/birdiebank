"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { syncDraftBets } from "@/lib/bets-service";
import { useHasHydrated } from "@/lib/hooks";
import { getDraft, setDraftBets } from "@/lib/rounds";
import { RoundSyncPill } from "@/lib/round-sync-pill";
import {
  DEFAULT_BETS,
  playedHoles,
  type Bets,
  type Player,
  type RoundDetails,
  type RoundSyncState,
  type TeamMatchMode,
} from "@/lib/types";

export default function BetsForm() {
  const hasHydrated = useHasHydrated();

  if (!hasHydrated) {
    return <FormSkeleton />;
  }

  const draft = getDraft();
  if (!draft?.details) {
    return (
      <NoDraftCard
        title="No round in progress"
        body="Start with round details so we can set up bets."
        ctaHref="/create-round"
        ctaLabel="Set round details"
      />
    );
  }
  if (!draft.players || draft.players.length < 2) {
    return (
      <NoDraftCard
        title="Add players first"
        body="Bets need at least two players. Pop back and add the foursome."
        ctaHref="/players"
        ctaLabel="Add players"
      />
    );
  }

  return (
    <BetsFormInner
      details={draft.details}
      players={draft.players}
      initialBets={draft.bets ?? DEFAULT_BETS}
      initialBetsSyncState={draft.betsSyncState}
    />
  );
}

function BetsFormInner({
  details,
  players,
  initialBets,
  initialBetsSyncState,
}: {
  details: RoundDetails;
  players: Player[];
  initialBets: Bets;
  initialBetsSyncState?: RoundSyncState;
}) {
  const router = useRouter();
  const [bets, setBets] = useState<Bets>(initialBets);
  const [touched, setTouched] = useState(false);
  const [betsSyncState, setBetsSyncState] = useState<RoundSyncState | undefined>(
    initialBetsSyncState,
  );
  const [continuing, setContinuing] = useState(false);

  const validHoles = useMemo(
    () => playedHoles(details.holes, details.startingHole),
    [details.holes, details.startingHole],
  );

  const errors = useMemo(() => validateBets(bets, players, validHoles), [
    bets,
    players,
    validHoles,
  ]);

  const teamMatchActive = bets.teamMatch.enabled && players.length === 4;

  const anyEnabled =
    bets.skins.enabled ||
    bets.nassau.enabled ||
    teamMatchActive ||
    bets.straightMatch.enabled ||
    bets.closestToPin.enabled;

  const canContinue = anyEnabled && Object.keys(errors).length === 0;

  function patch<K extends keyof Bets>(key: K, value: Partial<Bets[K]>) {
    setBets((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  }

  async function handleContinue() {
    setTouched(true);
    if (!canContinue || continuing) return;
    setDraftBets(bets);
    setContinuing(true);
    try {
      const result = await syncDraftBets(bets, players.length);
      setBetsSyncState(result.outcome);
      router.push("/scorecard");
    } finally {
      setContinuing(false);
    }
  }

  function handleBack() {
    setDraftBets(bets);
    router.push("/players");
  }

  const canShowTeamMatch = players.length === 4;

  return (
    <div className="flex flex-col gap-6">
      <RoundSummary details={details} />
      <SelectedPlayers players={players} />

      <div className="flex flex-col gap-3">
        <header className="flex flex-col gap-1.5 px-0.5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-fairway-700/80">
            Bet setup
          </h2>
          {betsSyncState ? (
            <RoundSyncPill
              state={betsSyncState}
              cloudLabel="Bets saved to cloud"
            />
          ) : null}
        </header>
        <SkinsCard
          bet={bets.skins}
          onChange={(v) => patch("skins", v)}
          error={touched ? errors.skins : undefined}
        />
        <NassauCard
          bet={bets.nassau}
          onChange={(v) => patch("nassau", v)}
          errors={touched ? errors.nassau : undefined}
        />
        {canShowTeamMatch ? (
          <TeamMatchCard
            bet={bets.teamMatch}
            players={players}
            onChange={(v) => patch("teamMatch", v)}
            errors={touched ? errors.teamMatch : undefined}
          />
        ) : (
          <p className="px-1 text-xs text-fairway-900/60">
            2v2 Team Match unlocks when you have exactly four players.
          </p>
        )}
        <StraightMatchCard
          bet={bets.straightMatch}
          players={players}
          onChange={(v) => patch("straightMatch", v)}
          errors={touched ? errors.straightMatch : undefined}
        />
        <ClosestToPinCard
          bet={bets.closestToPin}
          validHoles={validHoles}
          onChange={(v) => patch("closestToPin", v)}
          errors={touched ? errors.closestToPin : undefined}
        />
      </div>

      <ActionBar>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-12 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:h-11"
        >
          Back to Players
        </button>
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={!canContinue || continuing}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-fairway-700 px-6 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40 sm:h-11 sm:flex-none"
        >
          {continuing ? "Saving bets…" : "Continue to Scorecard"}
          {!continuing ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </ActionBar>

      {!anyEnabled ? (
        <p className="text-center text-xs text-fairway-900/60 sm:text-left">
          Turn on at least one bet to continue.
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Bet cards ---------- */

function SkinsCard({
  bet,
  onChange,
  error,
}: {
  bet: Bets["skins"];
  onChange: (v: Partial<Bets["skins"]>) => void;
  error?: string;
}) {
  const amountId = useId();
  return (
    <BetCard
      title="Skins"
      blurb="Lowest score wins the hole. Tie carries it over."
      enabled={bet.enabled}
      onToggle={(enabled) => onChange({ enabled })}
    >
      <MoneyField
        id={amountId}
        label="Amount per skin"
        value={bet.amount}
        onChange={(amount) => onChange({ amount })}
        error={error}
      />
    </BetCard>
  );
}

function NassauCard({
  bet,
  onChange,
  errors,
}: {
  bet: Bets["nassau"];
  onChange: (v: Partial<Bets["nassau"]>) => void;
  errors?: { front9?: string; back9?: string; total?: string };
}) {
  const frontId = useId();
  const backId = useId();
  const totalId = useId();
  return (
    <BetCard
      title="Nassau"
      blurb="Three bets: front 9, back 9, and overall match."
      enabled={bet.enabled}
      onToggle={(enabled) => onChange({ enabled })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MoneyField
          id={frontId}
          label="Front 9"
          value={bet.front9}
          onChange={(front9) => onChange({ front9 })}
          error={errors?.front9}
        />
        <MoneyField
          id={backId}
          label="Back 9"
          value={bet.back9}
          onChange={(back9) => onChange({ back9 })}
          error={errors?.back9}
        />
        <MoneyField
          id={totalId}
          label="Total"
          value={bet.total}
          onChange={(total) => onChange({ total })}
          error={errors?.total}
        />
      </div>
    </BetCard>
  );
}

function TeamMatchCard({
  bet,
  players,
  onChange,
  errors,
}: {
  bet: Bets["teamMatch"];
  players: Player[];
  onChange: (v: Partial<Bets["teamMatch"]>) => void;
  errors?: {
    players?: string;
    totalScoreAmount?: string;
    skinsAmount?: string;
  };
}) {
  const a1Id = useId();
  const a2Id = useId();
  const b1Id = useId();
  const b2Id = useId();
  const modeId = useId();
  const totalAmountId = useId();
  const skinsAmountId = useId();

  const showTotalAmount = bet.mode === "total-score" || bet.mode === "both";
  const showSkinsAmount = bet.mode === "team-skins" || bet.mode === "both";

  const allSelected = [
    bet.teamAPlayer1Id,
    bet.teamAPlayer2Id,
    bet.teamBPlayer1Id,
    bet.teamBPlayer2Id,
  ];
  const excludeExcept = (skip: number): string[] =>
    allSelected
      .filter((id, i) => i !== skip && !!id)
      .map((id) => id as string);

  return (
    <BetCard
      title="2v2 Team Match"
      blurb="Two teams of two. Pick a side, pick a mode, settle by team."
      enabled={bet.enabled}
      onToggle={(enabled) => onChange({ enabled })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TeamBlock label="Team A">
          <PlayerSelect
            id={a1Id}
            label="Player 1"
            players={players}
            value={bet.teamAPlayer1Id}
            onChange={(id) => onChange({ teamAPlayer1Id: id })}
            excludeIds={excludeExcept(0)}
            error={undefined}
          />
          <PlayerSelect
            id={a2Id}
            label="Player 2"
            players={players}
            value={bet.teamAPlayer2Id}
            onChange={(id) => onChange({ teamAPlayer2Id: id })}
            excludeIds={excludeExcept(1)}
            error={undefined}
          />
        </TeamBlock>
        <TeamBlock label="Team B">
          <PlayerSelect
            id={b1Id}
            label="Player 1"
            players={players}
            value={bet.teamBPlayer1Id}
            onChange={(id) => onChange({ teamBPlayer1Id: id })}
            excludeIds={excludeExcept(2)}
            error={undefined}
          />
          <PlayerSelect
            id={b2Id}
            label="Player 2"
            players={players}
            value={bet.teamBPlayer2Id}
            onChange={(id) => onChange({ teamBPlayer2Id: id })}
            excludeIds={excludeExcept(3)}
            error={undefined}
          />
        </TeamBlock>
      </div>

      {errors?.players ? (
        <p className="-mt-1 text-sm text-flag">{errors.players}</p>
      ) : null}

      <Field label="Bet mode" htmlFor={modeId}>
        <select
          id={modeId}
          value={bet.mode}
          onChange={(e) =>
            onChange({ mode: e.target.value as TeamMatchMode })
          }
          className={selectClass(false)}
        >
          <option value="total-score">Total Score</option>
          <option value="team-skins">Team Skins</option>
          <option value="both">Both</option>
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {showTotalAmount ? (
          <MoneyField
            id={totalAmountId}
            label="Total Score bet amount"
            value={bet.totalScoreAmount}
            onChange={(totalScoreAmount) => onChange({ totalScoreAmount })}
            error={errors?.totalScoreAmount}
          />
        ) : null}
        {showSkinsAmount ? (
          <MoneyField
            id={skinsAmountId}
            label="Team Skins amount per hole"
            value={bet.skinsAmount}
            onChange={(skinsAmount) => onChange({ skinsAmount })}
            error={errors?.skinsAmount}
          />
        ) : null}
      </div>
    </BetCard>
  );
}

function TeamBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-sand bg-cream/30 p-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
        {label}
      </span>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function StraightMatchCard({
  bet,
  players,
  onChange,
  errors,
}: {
  bet: Bets["straightMatch"];
  players: Player[];
  onChange: (v: Partial<Bets["straightMatch"]>) => void;
  errors?: { playerA?: string; playerB?: string; amount?: string };
}) {
  const aId = useId();
  const bId = useId();
  const amountId = useId();

  return (
    <BetCard
      title="Straight Match"
      blurb="Head-to-head between two players over the whole round."
      enabled={bet.enabled}
      onToggle={(enabled) => onChange({ enabled })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PlayerSelect
          id={aId}
          label="Player A"
          players={players}
          value={bet.playerAId}
          onChange={(playerAId) => onChange({ playerAId })}
          excludeIds={bet.playerBId ? [bet.playerBId] : []}
          error={errors?.playerA}
        />
        <PlayerSelect
          id={bId}
          label="Player B"
          players={players}
          value={bet.playerBId}
          onChange={(playerBId) => onChange({ playerBId })}
          excludeIds={bet.playerAId ? [bet.playerAId] : []}
          error={errors?.playerB}
        />
      </div>
      <MoneyField
        id={amountId}
        label="Match amount"
        value={bet.amount}
        onChange={(amount) => onChange({ amount })}
        error={errors?.amount}
      />
    </BetCard>
  );
}

function ClosestToPinCard({
  bet,
  validHoles,
  onChange,
  errors,
}: {
  bet: Bets["closestToPin"];
  validHoles: number[];
  onChange: (v: Partial<Bets["closestToPin"]>) => void;
  errors?: {
    list?: string;
    items?: Array<{ hole?: string; amount?: string } | undefined>;
  };
}) {
  const usedHoles = useMemo(
    () => new Set(bet.holes.map((h) => h.hole)),
    [bet.holes],
  );
  const availableHoles = useMemo(
    () => validHoles.filter((h) => !usedHoles.has(h)),
    [validHoles, usedHoles],
  );
  const canAdd = availableHoles.length > 0;

  function addHole() {
    if (!canAdd) return;
    const nextHole = availableHoles[0];
    onChange({
      holes: [...bet.holes, { hole: nextHole, amount: 10 }],
    });
  }

  function updateAt(idx: number, patch: Partial<{ hole: number; amount: number }>) {
    onChange({
      holes: bet.holes.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    });
  }

  function deleteAt(idx: number) {
    onChange({
      holes: bet.holes.filter((_, i) => i !== idx),
    });
  }

  return (
    <BetCard
      title="Closest to Pin"
      blurb="Add a pot for any number of par-3s. Ties push and roll forward to the next CTP hole."
      enabled={bet.enabled}
      onToggle={(enabled) => onChange({ enabled })}
    >
      {bet.holes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sand-dark/60 bg-cream/60 px-3 py-3 text-sm text-fairway-900/70">
          No closest-to-pin holes yet. Tap{" "}
          <span className="font-medium text-fairway-900">
            Add Closest to Pin Hole
          </span>{" "}
          to add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {bet.holes.map((item, idx) => (
            <CtpHoleRow
              key={idx}
              index={idx}
              hole={item.hole}
              amount={item.amount}
              validHoles={validHoles}
              otherUsedHoles={excludeForRow(usedHoles, item.hole)}
              onChangeHole={(hole) => updateAt(idx, { hole })}
              onChangeAmount={(amount) => updateAt(idx, { amount })}
              onDelete={() => deleteAt(idx)}
              errors={errors?.items?.[idx]}
            />
          ))}
        </ul>
      )}

      {errors?.list ? (
        <p className="text-sm text-flag">{errors.list}</p>
      ) : null}

      <button
        type="button"
        onClick={addHole}
        disabled={!canAdd}
        className="inline-flex h-11 items-center justify-center gap-1.5 self-start rounded-full border border-fairway-300 bg-cream/60 px-4 text-sm font-medium text-fairway-800 transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PlusIcon className="h-4 w-4" />
        Add Closest to Pin Hole
      </button>

      {!canAdd && bet.holes.length > 0 ? (
        <p className="text-xs text-fairway-900/60">
          Every played hole already has a CTP pot.
        </p>
      ) : null}
    </BetCard>
  );
}

function excludeForRow(allUsed: Set<number>, ownHole: number): Set<number> {
  const out = new Set(allUsed);
  out.delete(ownHole);
  return out;
}

function CtpHoleRow({
  index,
  hole,
  amount,
  validHoles,
  otherUsedHoles,
  onChangeHole,
  onChangeAmount,
  onDelete,
  errors,
}: {
  index: number;
  hole: number;
  amount: number;
  validHoles: number[];
  otherUsedHoles: Set<number>;
  onChangeHole: (h: number) => void;
  onChangeAmount: (n: number) => void;
  onDelete: () => void;
  errors?: { hole?: string; amount?: string };
}) {
  const holeId = useId();
  const amountId = useId();

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-sand bg-cream/30 p-3">
      <header className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80">
          Hole #{index + 1}
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove Closest to Pin hole #${index + 1}`}
          className="inline-flex h-8 items-center justify-center rounded-full border border-sand bg-white px-3 text-xs font-medium text-flag/90 transition hover:bg-flag/[0.06]"
        >
          Remove
        </button>
      </header>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="Hole" htmlFor={holeId} error={errors?.hole}>
          <select
            id={holeId}
            value={Number.isFinite(hole) ? String(hole) : ""}
            onChange={(e) => onChangeHole(Number(e.target.value))}
            className={selectClass(!!errors?.hole)}
          >
            {validHoles.map((h) => (
              <option
                key={h}
                value={h}
                disabled={otherUsedHoles.has(h)}
              >
                Hole {h}
                {otherUsedHoles.has(h) ? " (taken)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <MoneyField
          id={amountId}
          label="Pot amount"
          value={amount}
          onChange={onChangeAmount}
          error={errors?.amount}
        />
      </div>
    </li>
  );
}

function PlusIcon({ className = "" }: { className?: string }) {
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
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/* ---------- Shared field primitives ---------- */

function BetCard({
  title,
  blurb,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  blurb: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={[
        "flex flex-col gap-4 rounded-2xl border bg-white p-5 transition sm:p-6",
        enabled ? "border-fairway-200 shadow-[0_1px_0_rgba(20,32,26,0.04)]" : "border-sand/70",
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
            {title}
          </h2>
          <p className="text-sm leading-relaxed text-fairway-900/70">{blurb}</p>
        </div>
        <Toggle
          checked={enabled}
          onChange={onToggle}
          ariaLabel={`Toggle ${title}`}
        />
      </header>
      {enabled ? (
        <div className="flex flex-col gap-4 border-t border-sand/60 pt-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition",
        "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:ring-offset-2 focus:ring-offset-white",
        checked ? "bg-fairway-700" : "bg-sand-dark/70",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fairway-900">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-flag">{error}</p>
      ) : hint ? (
        <p className="text-xs text-fairway-900/60">{hint}</p>
      ) : null}
    </div>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-base font-medium text-fairway-900/50"
        >
          $
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? 0 : Number(v));
          }}
          className={[
            inputBaseClass(!!error),
            "pl-8 tabular-nums",
          ].join(" ")}
        />
      </div>
    </Field>
  );
}

function PlayerSelect({
  id,
  label,
  players,
  value,
  onChange,
  excludeIds,
  error,
}: {
  id: string;
  label: string;
  players: Player[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Player IDs that are already chosen elsewhere — disabled in this dropdown. */
  excludeIds?: ReadonlyArray<string>;
  error?: string;
}) {
  const excluded = new Set(excludeIds ?? []);
  return (
    <Field label={label} htmlFor={id} error={error}>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={selectClass(!!error)}
      >
        <option value="">Select player…</option>
        {players.map((p) => (
          <option key={p.id} value={p.id} disabled={excluded.has(p.id)}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function inputBaseClass(hasError: boolean): string {
  return [
    "h-12 w-full rounded-xl border bg-white px-3.5 text-base text-fairway-900",
    "placeholder:text-fairway-900/40",
    "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
    "transition",
    hasError ? "border-flag/70" : "border-sand",
  ].join(" ");
}

function selectClass(hasError: boolean): string {
  return [
    inputBaseClass(hasError),
    "appearance-none bg-[length:14px] bg-[right_0.875rem_center] bg-no-repeat pr-9",
    "bg-[url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%231c4a23'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e\")]",
  ].join(" ");
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
          href="/create-round"
          className="text-xs font-medium text-fairway-700 underline decoration-fairway-200 underline-offset-4 hover:text-fairway-900"
        >
          Edit
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

function SelectedPlayers({ players }: { players: Player[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-4 sm:p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fairway-700/80">
          Players in this round
        </h2>
        <Link
          href="/players"
          className="text-xs font-medium text-fairway-700 underline decoration-fairway-200 underline-offset-4 hover:text-fairway-900"
        >
          Edit
        </Link>
      </header>
      <ul className="flex flex-wrap gap-2">
        {players.map((p, i) => (
          <li
            key={p.id}
            className="inline-flex items-center gap-2 rounded-full border border-sand bg-cream/40 px-3 py-1 text-sm text-fairway-900"
          >
            <span
              aria-hidden
              className="flex h-5 w-5 items-center justify-center rounded-full bg-fairway-100 font-mono text-[11px] font-semibold text-fairway-700"
            >
              {i + 1}
            </span>
            {p.name}
          </li>
        ))}
      </ul>
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

function NoDraftCard({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-6">
      <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-fairway-900/70">{body}</p>
      <Link
        href={ctaHref}
        className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-full bg-fairway-700 px-5 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="h-20 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-16 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-28 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-28 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-28 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-28 rounded-2xl border border-sand/70 bg-cream/60" />
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

/* ---------- Validation ---------- */

type BetsErrors = {
  skins?: string;
  nassau?: { front9?: string; back9?: string; total?: string };
  teamMatch?: {
    players?: string;
    totalScoreAmount?: string;
    skinsAmount?: string;
  };
  straightMatch?: {
    playerA?: string;
    playerB?: string;
    amount?: string;
  };
  closestToPin?: {
    /** A list-wide error (e.g. "Add at least one hole"). */
    list?: string;
    /** Per-row errors aligned with `bet.holes`. Sparse — only failing rows. */
    items?: Array<{ hole?: string; amount?: string } | undefined>;
  };
};

function validateBets(
  bets: Bets,
  players: Player[],
  validHoles: number[],
): BetsErrors {
  const errors: BetsErrors = {};

  if (bets.skins.enabled) {
    if (!isPositive(bets.skins.amount)) {
      errors.skins = "Enter an amount greater than zero.";
    }
  }

  if (bets.nassau.enabled) {
    const nassau: NonNullable<BetsErrors["nassau"]> = {};
    if (!isNonNegative(bets.nassau.front9)) nassau.front9 = "Enter an amount.";
    if (!isNonNegative(bets.nassau.back9)) nassau.back9 = "Enter an amount.";
    if (!isNonNegative(bets.nassau.total)) nassau.total = "Enter an amount.";
    if (
      bets.nassau.front9 === 0 &&
      bets.nassau.back9 === 0 &&
      bets.nassau.total === 0
    ) {
      nassau.total = "At least one Nassau amount must be greater than zero.";
    }
    if (Object.keys(nassau).length) errors.nassau = nassau;
  }

  if (bets.teamMatch.enabled && players.length === 4) {
    const tm: NonNullable<BetsErrors["teamMatch"]> = {};
    const validIds = new Set(players.map((p) => p.id));
    const ids = [
      bets.teamMatch.teamAPlayer1Id,
      bets.teamMatch.teamAPlayer2Id,
      bets.teamMatch.teamBPlayer1Id,
      bets.teamMatch.teamBPlayer2Id,
    ];
    const filled = ids.filter((id): id is string => !!id);
    if (filled.length !== 4) {
      tm.players = "Pick a player for every seat on both teams.";
    } else if (new Set(filled).size !== filled.length) {
      tm.players = "Each player can only be on one team.";
    } else if (!filled.every((id) => validIds.has(id))) {
      tm.players = "Some picks are no longer in the player list.";
    }
    const mode = bets.teamMatch.mode;
    if (
      (mode === "total-score" || mode === "both") &&
      !isPositive(bets.teamMatch.totalScoreAmount)
    ) {
      tm.totalScoreAmount = "Enter an amount greater than zero.";
    }
    if (
      (mode === "team-skins" || mode === "both") &&
      !isPositive(bets.teamMatch.skinsAmount)
    ) {
      tm.skinsAmount = "Enter an amount greater than zero.";
    }
    if (Object.keys(tm).length) errors.teamMatch = tm;
  }

  if (bets.straightMatch.enabled) {
    const sm: NonNullable<BetsErrors["straightMatch"]> = {};
    const validIds = new Set(players.map((p) => p.id));
    if (!bets.straightMatch.playerAId || !validIds.has(bets.straightMatch.playerAId)) {
      sm.playerA = "Pick a player.";
    }
    if (!bets.straightMatch.playerBId || !validIds.has(bets.straightMatch.playerBId)) {
      sm.playerB = "Pick a player.";
    }
    if (
      bets.straightMatch.playerAId &&
      bets.straightMatch.playerBId &&
      bets.straightMatch.playerAId === bets.straightMatch.playerBId
    ) {
      sm.playerB = "Pick a different player.";
    }
    if (!isPositive(bets.straightMatch.amount)) {
      sm.amount = "Enter an amount greater than zero.";
    }
    if (Object.keys(sm).length) errors.straightMatch = sm;
  }

  if (bets.closestToPin.enabled) {
    const cp: NonNullable<BetsErrors["closestToPin"]> = {};
    const list = bets.closestToPin.holes;
    if (list.length === 0) {
      cp.list = "Add at least one Closest to Pin hole.";
    } else {
      const items: Array<{ hole?: string; amount?: string } | undefined> = [];
      const seen = new Set<number>();
      let hasItemError = false;
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        const issues: { hole?: string; amount?: string } = {};
        if (
          typeof entry.hole !== "number" ||
          !validHoles.includes(entry.hole)
        ) {
          issues.hole = "Pick a hole in this round.";
        } else if (seen.has(entry.hole)) {
          issues.hole = "Already chosen for another row.";
        } else {
          seen.add(entry.hole);
        }
        if (!isPositive(entry.amount)) {
          issues.amount = "Enter an amount greater than zero.";
        }
        if (Object.keys(issues).length) {
          items[i] = issues;
          hasItemError = true;
        } else {
          items[i] = undefined;
        }
      }
      if (hasItemError) cp.items = items;
    }
    if (Object.keys(cp).length) errors.closestToPin = cp;
  }

  return errors;
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}
function isNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}
