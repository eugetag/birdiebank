"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  syncDraftRoundPlayers,
  syncSingleRoundPlayer,
} from "@/lib/round-players-service";
import { getDraft, setDraftPlayers } from "@/lib/rounds";
import { RoundSyncPill } from "@/lib/round-sync-pill";
import { useHasHydrated } from "@/lib/hooks";
import {
  formatMoney as formatCurrencyMoney,
  methodsForCountry,
} from "@/lib/payments";
import {
  isContactPickerSupported,
  pickContactFromDevice,
} from "@/lib/contact-picker";
import {
  getDirectory,
  normalizeContactKey,
  type DirectoryMap,
} from "@/lib/directory";
import {
  emptyCurrencyBag,
  getAggregateLedgerStats,
  getLedger,
  getPlayerLedgerStats,
  type AggregateLedgerStats,
  type CurrencyBag,
  type PlayerLedgerStats,
} from "@/lib/ledger";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Country,
  type Currency,
  type DirectoryEntry,
  type LedgerEntry,
  type PaymentMethod,
  type PaymentProfile,
  type Player,
  type RoundDetails,
  type RoundSyncState,
} from "@/lib/types";

const DEFAULT_COUNTRY: Country = "United States";
const DEFAULT_METHOD: PaymentMethod = "Cash";

function defaultProfile(): PaymentProfile {
  return { country: DEFAULT_COUNTRY, preferredMethod: DEFAULT_METHOD };
}

/** Hydrate a PaymentProfile from a directory entry, filling required fields. */
function profileFromDirectory(entry: DirectoryEntry): PaymentProfile {
  return {
    country: entry.country ?? DEFAULT_COUNTRY,
    preferredMethod: entry.preferredMethod ?? DEFAULT_METHOD,
    interacEmail: entry.interacEmail,
    interacPhone: entry.interacPhone,
    venmoHandle: entry.venmoHandle,
    cashAppTag: entry.cashAppTag,
    paypalLink: entry.paypalLink,
    zelleEmail: entry.zelleEmail,
    zellePhone: entry.zellePhone,
    notes: entry.notes,
  };
}

function genId(): string {
  if (
    typeof window !== "undefined" &&
    "crypto" in window &&
    "randomUUID" in window.crypto
  ) {
    return window.crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export default function PlayersForm() {
  const hasHydrated = useHasHydrated();

  if (!hasHydrated) {
    return <FormSkeleton />;
  }

  const draft = getDraft();
  if (!draft?.details) {
    return <NoDraftCard />;
  }
  return (
    <PlayersFormInner
      details={draft.details}
      initialPlayers={draft.players ?? []}
      initialPlayersSyncState={draft.playersSyncState}
    />
  );
}

function PlayersFormInner({
  details,
  initialPlayers,
  initialPlayersSyncState,
}: {
  details: RoundDetails;
  initialPlayers: Player[];
  initialPlayersSyncState?: RoundSyncState;
}) {
  const router = useRouter();
  const nameInputId = useId();
  const emailInputId = useId();
  const phoneInputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [contactImporting, setContactImporting] = useState(false);
  const [contactImportError, setContactImportError] = useState<
    string | undefined
  >(undefined);
  const [playersSyncState, setPlayersSyncState] = useState<
    RoundSyncState | undefined
  >(initialPlayersSyncState);
  const [continuing, setContinuing] = useState(false);

  const contactPickerAvailable = useMemo(() => isContactPickerSupported(), []);

  // Cross-round snapshots read once at mount. The players page is read-only
  // for both the directory (only /results writes) and the ledger.
  const [directory] = useState<DirectoryMap>(() => getDirectory());
  const [ledger] = useState<LedgerEntry[]>(() => getLedger());

  const atCapacity = players.length >= MAX_PLAYERS;
  const canContinue = players.length >= MIN_PLAYERS;

  const normalizedNames = useMemo(
    () => new Set(players.map((p) => p.name.trim().toLowerCase())),
    [players],
  );
  const usedContactKeys = useMemo(
    () =>
      new Set(
        players
          .map((p) => p.normalizedContactKey)
          .filter((k): k is string => !!k),
      ),
    [players],
  );

  // Live recognition: as the host types email/phone, derive the candidate
  // contact key and look it up in the directory snapshot.
  const draftKey = useMemo(() => {
    const e = email.trim();
    const p = phone.trim();
    if (!e && !p) return null;
    return normalizeContactKey({ email: e, phone: p, fallbackId: "" });
  }, [email, phone]);

  const draftMatch = useMemo<DirectoryEntry | null>(() => {
    if (!draftKey || draftKey.startsWith("guest:")) return null;
    return directory[draftKey] ?? null;
  }, [draftKey, directory]);

  const draftMatchStats = useMemo<PlayerLedgerStats | null>(
    () => (draftMatch ? getPlayerLedgerStats(draftMatch.normalizedContactKey, ledger) : null),
    [draftMatch, ledger],
  );

  function addPlayer() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (atCapacity) {
      setError(`Maximum ${MAX_PLAYERS} players.`);
      return;
    }

    // If the host left the name blank but a directory match was found,
    // use the saved display name automatically.
    const finalName =
      trimmedName || (draftMatch ? draftMatch.displayName : "");
    if (!finalName) {
      setError("Add a name first.");
      return;
    }
    if (normalizedNames.has(finalName.toLowerCase())) {
      setError("That name is already added.");
      return;
    }

    const id = genId();
    const contactKey =
      trimmedEmail || trimmedPhone
        ? normalizeContactKey({
            email: trimmedEmail,
            phone: trimmedPhone,
            fallbackId: id,
          })
        : undefined;

    if (contactKey && usedContactKeys.has(contactKey)) {
      setError("That email or phone is already added.");
      return;
    }

    const player: Player = {
      id,
      name: finalName,
      normalizedContactKey: contactKey,
      paymentProfile: draftMatch
        ? profileFromDirectory(draftMatch)
        : undefined,
    };

    setPlayers((prev) => [...prev, player]);
    setName("");
    setEmail("");
    setPhone("");
    setError(undefined);
    // Keep keyboard up on mobile so hosts can add a few quickly.
    inputRef.current?.focus();

    void syncSingleRoundPlayer(player).then((result) => {
      setPlayersSyncState(result.outcome);
    });
  }

  function removePlayer(id: string) {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    setError(undefined);
  }

  function updatePlayerProfile(
    id: string,
    patch: Partial<PaymentProfile>,
  ) {
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const current = p.paymentProfile ?? defaultProfile();
        const next: PaymentProfile = { ...current, ...patch };
        // If the country changed, snap the preferred method to one that
        // makes sense for the new country so the conditional form is sane.
        if (patch.country && patch.country !== current.country) {
          const allowed = methodsForCountry(next.country);
          if (!allowed.includes(next.preferredMethod)) {
            next.preferredMethod = allowed[0];
          }
        }
        return { ...p, paymentProfile: next };
      }),
    );
  }

  // Auto-save players to the draft so payment edits survive a refresh
  // without forcing the host to navigate.
  useEffect(() => {
    setDraftPlayers(players);
  }, [players]);

  function handleAddSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    addPlayer();
  }

  async function handleImportFromContacts() {
    if (!contactPickerAvailable || atCapacity) return;
    setContactImportError(undefined);
    setContactImporting(true);
    try {
      const picked = await pickContactFromDevice();
      if (!picked) return;
      if (picked.name) setName(picked.name);
      if (picked.email) setEmail(picked.email);
      if (picked.phone) setPhone(picked.phone);
      if (error) setError(undefined);
      inputRef.current?.focus();
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "SecurityError"
          ? "Contact import needs a secure connection (HTTPS)."
          : err instanceof Error
            ? err.message
            : "Could not open contacts.";
      setContactImportError(message);
    } finally {
      setContactImporting(false);
    }
  }

  async function handleContinue() {
    if (!canContinue || continuing) return;
    setDraftPlayers(players);
    setContinuing(true);
    try {
      const result = await syncDraftRoundPlayers(players);
      setPlayersSyncState(result.outcome);
      router.push("/bets");
    } finally {
      setContinuing(false);
    }
  }

  function handleBack() {
    // Persist any in-progress players so back+forward keeps them.
    setDraftPlayers(players);
    router.push("/create-round");
  }

  return (
    <div className="flex flex-col gap-6">
      <RoundSummary details={details} />

      <section className="flex flex-col gap-4 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
              Players
            </h2>
            <p className="text-sm leading-relaxed text-fairway-900/70">
              Add everyone in the foursome. Up to {MAX_PLAYERS}. Guests
              don&apos;t need an account.
            </p>
            {playersSyncState ? (
              <RoundSyncPill
                state={playersSyncState}
                cloudLabel="Players saved to cloud"
              />
            ) : null}
          </div>
          <PlayersCounter count={players.length} max={MAX_PLAYERS} />
        </header>

        <form
          onSubmit={handleAddSubmit}
          noValidate
          className="flex flex-col gap-2"
        >
          <label htmlFor={nameInputId} className="sr-only">
            Player name
          </label>
          <div className="flex gap-2">
            <input
              id={nameInputId}
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(undefined);
              }}
              placeholder={
                atCapacity
                  ? "Foursome is full"
                  : draftMatch
                    ? `Use “${draftMatch.displayName}” or override`
                    : "Player name"
              }
              disabled={atCapacity}
              autoComplete="off"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              maxLength={40}
              className={inputClass(!!error)}
            />
            <button
              type="submit"
              disabled={
                atCapacity ||
                (!name.trim() && !draftMatch)
              }
              aria-label="Add player"
              className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-fairway-700 px-4 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40"
            >
              <PlusIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Add player</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ContactInput
              id={emailInputId}
              label="Email (optional)"
              value={email}
              onChange={(v) => {
                setEmail(v);
                if (error) setError(undefined);
              }}
              type="email"
              placeholder="name@email.com"
              autoComplete="email"
              disabled={atCapacity}
            />
            <ContactInput
              id={phoneInputId}
              label="Phone (optional)"
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (error) setError(undefined);
              }}
              type="tel"
              placeholder="+1 555 123 4567"
              autoComplete="tel"
              disabled={atCapacity}
            />
          </div>

          {contactPickerAvailable ? (
            <button
              type="button"
              disabled={atCapacity || contactImporting}
              onClick={() => void handleImportFromContacts()}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-fairway-600/30 bg-fairway-50 px-4 text-sm font-medium text-fairway-800 transition hover:border-fairway-600/50 hover:bg-fairway-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {contactImporting ? (
                <SpinnerIcon className="h-4 w-4 animate-spin" />
              ) : (
                <ContactsIcon className="h-4 w-4 shrink-0" />
              )}
              {contactImporting ? "Opening contacts…" : "Import from Contacts"}
            </button>
          ) : (
            <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-2.5 text-center text-xs leading-relaxed text-fairway-900/65">
              Contact import is not supported on this browser. You can still add
              players manually.
            </p>
          )}

          {contactImportError ? (
            <p className="text-sm text-flag">{contactImportError}</p>
          ) : null}

          {draftMatch ? (
            <RecognitionPreview
              entry={draftMatch}
              stats={draftMatchStats}
              alreadyAdded={
                !!draftMatch.normalizedContactKey &&
                usedContactKeys.has(draftMatch.normalizedContactKey)
              }
            />
          ) : null}

          {error ? (
            <p className="text-sm text-flag">{error}</p>
          ) : draftMatch ? null : email.trim() || phone.trim() ? (
            <p className="text-xs text-fairway-900/60">
              New contact — we&apos;ll create a fresh entry for them.
            </p>
          ) : (
            <p className="text-xs text-fairway-900/60">
              Add email or phone to recognise returning players across rounds.
            </p>
          )}
        </form>

        {players.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="flex flex-col gap-2">
            {players.map((p, i) => (
              <PlayerCard
                key={p.id}
                index={i}
                player={p}
                directoryEntry={
                  p.normalizedContactKey
                    ? directory[p.normalizedContactKey]
                    : undefined
                }
                ledger={ledger}
                onRemove={() => removePlayer(p.id)}
                onProfileChange={(patch) => updatePlayerProfile(p.id, patch)}
              />
            ))}
          </ul>
        )}
      </section>

      <PreviousBetsSummary players={players} ledger={ledger} />

      <ActionBar>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-12 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:h-11"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={!canContinue || continuing}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-fairway-700 px-6 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40 sm:h-11 sm:flex-none"
        >
          {continuing ? "Saving players…" : "Continue to Bets"}
          {!continuing ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </ActionBar>

      {!canContinue ? (
        <p className="text-center text-xs text-fairway-900/60 sm:text-left">
          Add at least {MIN_PLAYERS} players to continue.
        </p>
      ) : null}
    </div>
  );
}

/* ---------- presentational helpers ---------- */

function RoundSummary({ details }: { details: RoundDetails }) {
  const roundSyncState = getDraft()?.roundSyncState;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-cream/60 p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold tracking-tight text-fairway-900">
              {details.courseName}
            </h2>
            {details.roundName ? (
              <p className="text-sm text-fairway-900/70">{details.roundName}</p>
            ) : null}
          </div>
          {roundSyncState ? <RoundSyncPill state={roundSyncState} /> : null}
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

function PlayerCard({
  index,
  player,
  directoryEntry,
  ledger,
  onRemove,
  onProfileChange,
}: {
  index: number;
  player: Player;
  directoryEntry: DirectoryEntry | undefined;
  ledger: LedgerEntry[];
  onRemove: () => void;
  onProfileChange: (patch: Partial<PaymentProfile>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const hasProfile = !!player.paymentProfile;
  const isReturning = !!directoryEntry;

  const playerStats = useMemo<PlayerLedgerStats | null>(
    () =>
      player.normalizedContactKey
        ? getPlayerLedgerStats(player.normalizedContactKey, ledger)
        : null,
    [player.normalizedContactKey, ledger],
  );

  const hasUnsettled = !!playerStats && playerStats.unsettledEntries > 0;

  return (
    <li
      className={[
        "flex flex-col gap-0 rounded-xl border bg-cream/30 transition hover:bg-cream/60",
        isReturning ? "border-fairway-300/70" : "border-sand",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 p-3 pr-2">
        <span
          aria-hidden
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-100 font-mono text-sm font-semibold text-fairway-700"
        >
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-base font-medium text-fairway-900">
              {player.name}
            </span>
            {isReturning ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fairway-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cream">
                <SparkleIcon className="h-2.5 w-2.5" />
                Returning
              </span>
            ) : null}
          </div>
          {directoryEntry?.email || directoryEntry?.phone ? (
            <p className="truncate font-mono text-[11px] text-fairway-900/60">
              {directoryEntry.email ?? directoryEntry.phone}
            </p>
          ) : null}
          {hasUnsettled ? (
            <PlayerBalanceLine
              name={player.name}
              stats={playerStats!}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${player.name}`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fairway-900/60 transition hover:bg-sand/60 hover:text-flag"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex items-center justify-between gap-2 border-t border-sand/70 px-3 py-2.5 text-left text-xs font-medium text-fairway-700/90 transition hover:bg-cream/80"
      >
        <span className="flex items-center gap-2">
          <WalletIcon className="h-3.5 w-3.5" />
          Settlement info
          {hasProfile ? (
            <span className="rounded-full bg-fairway-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-700">
              {player.paymentProfile?.preferredMethod}
              {isReturning ? " · prefilled" : ""}
            </span>
          ) : (
            <span className="text-[11px] font-normal text-fairway-900/50">
              optional
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
          <SettlementInfoForm
            profile={player.paymentProfile ?? defaultProfile()}
            onChange={onProfileChange}
          />
        </div>
      ) : null}
    </li>
  );
}

function PlayerBalanceLine({
  name,
  stats,
}: {
  name: string;
  stats: PlayerLedgerStats;
}) {
  const owesParts = currencyBagToStrings(stats.owes);
  const owedParts = currencyBagToStrings(stats.owed);
  const netParts = signedCurrencyBagToStrings(stats.net);
  const noun = stats.unsettledRounds === 1 ? "round" : "rounds";

  // Show a single net-headline line plus a friendly round count.
  // If the net is exactly zero but there are unsettled entries (i.e. the
  // player both owes and is owed equal amounts), surface both halves.
  if (netParts.length === 0) {
    if (owesParts.length || owedParts.length) {
      return (
        <p className="text-[11px] text-fairway-900/70">
          Owes {owesParts.join(" + ")} · owed {owedParts.join(" + ")} ·{" "}
          {stats.unsettledRounds} {noun}
        </p>
      );
    }
    return null;
  }

  return (
    <p className="text-[11px] font-medium text-fairway-900/80">
      <span className="text-fairway-900/60">Previous unpaid balance:</span>{" "}
      <span className="font-semibold text-fairway-900">
        {netHeadline(name, stats.net)}
      </span>{" "}
      <span className="text-fairway-900/60">
        · {stats.unsettledRounds} unsettled {noun}
      </span>
    </p>
  );
}

function netHeadline(name: string, net: CurrencyBag): string {
  const parts: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    const v = net[c];
    if (Math.abs(v) < 0.005) continue;
    const verb = v > 0 ? "owes" : "is owed";
    parts.push(`${name} ${verb} ${formatCurrencyMoney(Math.abs(v), c)}`);
  }
  return parts.length ? parts.join(" · ") : `${name} is settled up`;
}

function currencyBagToStrings(bag: CurrencyBag): string[] {
  const out: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    if (Math.abs(bag[c]) >= 0.005) {
      out.push(formatCurrencyMoney(bag[c], c));
    }
  }
  return out;
}

function signedCurrencyBagToStrings(bag: CurrencyBag): string[] {
  const out: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    if (Math.abs(bag[c]) >= 0.005) {
      const sign = bag[c] > 0 ? "+" : "-";
      out.push(`${sign}${formatCurrencyMoney(Math.abs(bag[c]), c)}`);
    }
  }
  return out;
}

function ContactInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type,
  autoComplete,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type: "email" | "tel";
  autoComplete: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[10px] font-semibold uppercase tracking-wider text-fairway-700/70"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode={type === "tel" ? "tel" : "email"}
        disabled={disabled}
        maxLength={80}
        className={[
          "h-10 w-full rounded-lg border border-sand bg-white px-3 text-sm text-fairway-900 placeholder:text-fairway-900/40",
          "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
          "disabled:cursor-not-allowed disabled:bg-cream disabled:text-fairway-900/50",
        ].join(" ")}
      />
    </div>
  );
}

function RecognitionPreview({
  entry,
  stats,
  alreadyAdded,
}: {
  entry: DirectoryEntry;
  stats: PlayerLedgerStats | null;
  alreadyAdded: boolean;
}) {
  const balanceLabel = stats
    ? netHeadline(entry.displayName, stats.net)
    : `${entry.displayName} is settled up`;
  const unsettled = stats?.unsettledRounds ?? 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-fairway-300 bg-fairway-50 p-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-fairway-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cream">
          <SparkleIcon className="h-2.5 w-2.5" />
          Returning Player
        </span>
        <span className="text-sm font-semibold text-fairway-900">
          {entry.displayName}
        </span>
        {entry.preferredMethod ? (
          <span className="rounded-full border border-fairway-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-700">
            {entry.preferredMethod}
          </span>
        ) : null}
        {alreadyAdded ? (
          <span className="rounded-full border border-flag/40 bg-flag/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-flag">
            Already in round
          </span>
        ) : null}
      </header>
      <p className="text-xs text-fairway-900/80">
        <span className="text-fairway-900/60">Previous unpaid balance:</span>{" "}
        <span className="font-semibold text-fairway-900">{balanceLabel}</span>
      </p>
      <p className="text-[11px] text-fairway-900/60">
        {unsettled === 0
          ? "No unsettled rounds on file."
          : `${unsettled} unsettled ${unsettled === 1 ? "round" : "rounds"} on file.`}
        {!alreadyAdded
          ? " Settlement preferences will load when you tap Add."
          : ""}
      </p>
    </div>
  );
}

/* ---------- Previous bets summary ---------- */

function PreviousBetsSummary({
  players,
  ledger,
}: {
  players: Player[];
  ledger: LedgerEntry[];
}) {
  const keys = useMemo(
    () =>
      new Set(
        players
          .map((p) => p.normalizedContactKey)
          .filter((k): k is string => !!k),
      ),
    [players],
  );

  const stats = useMemo<AggregateLedgerStats>(
    () =>
      keys.size === 0
        ? {
            roundsPlayed: 0,
            outstandingTotal: emptyCurrencyBag(),
            pendingCount: 0,
            largestOutstanding: null,
          }
        : getAggregateLedgerStats(keys, ledger),
    [keys, ledger],
  );

  const outstandingParts = currencyBagToStrings(stats.outstandingTotal);
  const recognised = keys.size;
  const noRecognised = recognised === 0;
  const noHistory = stats.roundsPlayed === 0;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-cream/40 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
            Ledger
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
            Previous Bets Summary
          </h2>
          <p className="text-xs text-fairway-900/70">
            Cross-round totals for everyone in this lineup — based only on
            recognised players with saved settlement info.
          </p>
        </div>
        {recognised > 0 ? (
          <span className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-0.5 text-xs font-semibold text-fairway-700">
            {recognised} recognised
          </span>
        ) : null}
      </header>

      {noRecognised ? (
        <p className="rounded-xl border border-dashed border-sand bg-white/60 px-3 py-3 text-center text-xs text-fairway-900/70">
          Add an email or phone above to start linking players across rounds.
        </p>
      ) : noHistory ? (
        <p className="rounded-xl border border-dashed border-sand bg-white/60 px-3 py-3 text-center text-xs text-fairway-900/70">
          No ledger history yet for this group. Bets you mark on the results
          page will start filling this up.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryStat label="Rounds Played" value={`${stats.roundsPlayed}`} />
          <SummaryStat
            label="Outstanding"
            value={outstandingParts.length ? outstandingParts.join(" + ") : "$0"}
            tone={outstandingParts.length ? "warn" : "neutral"}
          />
          <SummaryStat label="Pending Bets" value={`${stats.pendingCount}`} />
          <SummaryStat
            label="Largest Debt"
            value={
              stats.largestOutstanding
                ? formatCurrencyMoney(
                    stats.largestOutstanding.amount,
                    stats.largestOutstanding.currency,
                  )
                : "$0"
            }
            tone={stats.largestOutstanding ? "warn" : "neutral"}
          />
        </div>
      )}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-sand bg-white px-3 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fairway-700/70">
        {label}
      </span>
      <span
        className={[
          "truncate font-mono text-sm font-semibold tabular-nums",
          tone === "warn" ? "text-flag/90" : "text-fairway-900",
        ].join(" ")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function SettlementInfoForm({
  profile,
  onChange,
}: {
  profile: PaymentProfile;
  onChange: (patch: Partial<PaymentProfile>) => void;
}) {
  const countryId = useId();
  const methodId = useId();
  const methods = useMemo(
    () => methodsForCountry(profile.country),
    [profile.country],
  );

  // What fields to render depends on country (per spec).
  const showInterac = profile.country === "Canada";
  const showVenmo = profile.country === "United States";
  const showCashApp = profile.country === "United States";
  const showZelle = profile.country === "United States";
  // PayPal is optional on both supported countries (and offered to "Other" too).
  const showPaypal = true;
  // Always offer free-form notes.
  const showNotes = true;

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-sand bg-cream/30 px-2.5 py-1.5 text-[11px] text-fairway-900/70">
        We never collect bank or card info — these details just power
        copy-pasteable payment instructions on the results page.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ProfileField label="Country" htmlFor={countryId}>
          <select
            id={countryId}
            value={profile.country}
            onChange={(e) =>
              onChange({ country: e.target.value as Country })
            }
            className={selectClass()}
          >
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
            <option value="Other">Other</option>
          </select>
        </ProfileField>

        <ProfileField label="Preferred method" htmlFor={methodId}>
          <select
            id={methodId}
            value={profile.preferredMethod}
            onChange={(e) =>
              onChange({ preferredMethod: e.target.value as PaymentMethod })
            }
            className={selectClass()}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </ProfileField>
      </div>

      {showInterac ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Interac e-Transfer email"
            value={profile.interacEmail ?? ""}
            onChange={(v) => onChange({ interacEmail: v || undefined })}
            type="email"
            placeholder="name@email.com"
            autoComplete="email"
          />
          <TextField
            label="Interac e-Transfer phone"
            value={profile.interacPhone ?? ""}
            onChange={(v) => onChange({ interacPhone: v || undefined })}
            type="tel"
            placeholder="+1 555 123 4567"
            autoComplete="tel"
          />
        </div>
      ) : null}

      {showVenmo || showCashApp ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {showVenmo ? (
            <TextField
              label="Venmo handle"
              value={profile.venmoHandle ?? ""}
              onChange={(v) => onChange({ venmoHandle: v || undefined })}
              placeholder="@yourhandle"
              autoComplete="off"
            />
          ) : null}
          {showCashApp ? (
            <TextField
              label="Cash App $Cashtag"
              value={profile.cashAppTag ?? ""}
              onChange={(v) => onChange({ cashAppTag: v || undefined })}
              placeholder="$yourtag"
              autoComplete="off"
            />
          ) : null}
        </div>
      ) : null}

      {showZelle ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Zelle email"
            value={profile.zelleEmail ?? ""}
            onChange={(v) => onChange({ zelleEmail: v || undefined })}
            type="email"
            placeholder="name@email.com"
            autoComplete="email"
          />
          <TextField
            label="Zelle phone"
            value={profile.zellePhone ?? ""}
            onChange={(v) => onChange({ zellePhone: v || undefined })}
            type="tel"
            placeholder="+1 555 123 4567"
            autoComplete="tel"
          />
        </div>
      ) : null}

      {showPaypal ? (
        <TextField
          label="PayPal link or email"
          value={profile.paypalLink ?? ""}
          onChange={(v) => onChange({ paypalLink: v || undefined })}
          type="url"
          placeholder="paypal.me/yourname"
          autoComplete="url"
        />
      ) : null}

      {showNotes ? (
        <TextField
          label="Notes"
          value={profile.notes ?? ""}
          onChange={(v) => onChange({ notes: v || undefined })}
          placeholder="Anything the others should know (alt. handles, prefs, etc.)"
          autoComplete="off"
          multiline
        />
      ) : null}
    </div>
  );
}

function ProfileField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wider text-fairway-700/80"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function TextField({
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
          inputMode={type === "tel" ? "tel" : type === "email" ? "email" : undefined}
          className="h-10 w-full rounded-lg border border-sand bg-white px-3 text-sm text-fairway-900 placeholder:text-fairway-900/40 focus:border-fairway-500 focus:outline-none focus:ring-2 focus:ring-fairway-500/40"
        />
      )}
    </div>
  );
}

function selectClass(): string {
  return [
    "h-10 w-full appearance-none rounded-lg border border-sand bg-white px-3 pr-9 text-sm text-fairway-900",
    "bg-[length:14px] bg-[right_0.75rem_center] bg-no-repeat",
    "bg-[url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%231c4a23'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e\")]",
    "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
  ].join(" ");
}

function PlayersCounter({ count, max }: { count: number; max: number }) {
  return (
    <span
      className={[
        "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        count >= max
          ? "border-fairway-200 bg-fairway-100 text-fairway-700"
          : "border-sand bg-white text-fairway-900/70",
      ].join(" ")}
      aria-label={`${count} of ${max} players added`}
    >
      {count} / {max}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-sand bg-cream/30 px-4 py-6 text-center">
      <p className="text-sm font-medium text-fairway-900">No players yet</p>
      <p className="text-xs text-fairway-900/60">
        Add yourself and the rest of your group.
      </p>
    </div>
  );
}

function NoDraftCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-6">
      <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
        No round in progress
      </h2>
      <p className="text-sm leading-relaxed text-fairway-900/70">
        Start with the round details — we&apos;ll bring you right back here to
        add players.
      </p>
      <Link
        href="/create-round"
        className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-full bg-fairway-700 px-5 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600"
      >
        Set round details
      </Link>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="h-20 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="flex flex-col gap-4 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
        <div className="h-5 w-24 rounded-full bg-cream" />
        <div className="h-12 w-full rounded-xl bg-cream" />
        <div className="h-14 w-full rounded-xl bg-cream" />
        <div className="h-14 w-full rounded-xl bg-cream" />
      </div>
      <div className="h-12 w-full rounded-full bg-cream" />
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

function inputClass(hasError: boolean): string {
  return [
    "h-12 w-full rounded-xl border bg-white px-3.5 text-base text-fairway-900",
    "placeholder:text-fairway-900/40",
    "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
    "disabled:cursor-not-allowed disabled:bg-cream disabled:text-fairway-900/50",
    "transition",
    hasError ? "border-flag/70" : "border-sand",
  ].join(" ");
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

function ContactsIcon({ className = "" }: { className?: string }) {
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
      <path d="M16 11c1.657 0 3-1.343 3-3S17.657 5 16 5s-3 1.343-3 3 1.343 3 3 3z" />
      <path d="M8 11c1.657 0 3-1.343 3-3S9.657 5 8 5 5 6.343 5 8s1.343 3 3 3z" />
      <path d="M8 13c-2.761 0-5 1.79-5 4v1h6" />
      <path d="M16 13c-.775 0-1.5.18-2.13.5" />
      <path d="M21 18v1h-6" />
      <path d="M12 18v1H3v-1c0-2.21 3.582-4 8-4s8 1.79 8 4z" />
    </svg>
  );
}

function SpinnerIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
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

function TrashIcon({ className = "" }: { className?: string }) {
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
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
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
      <path d="M12 2l1.6 4.8L18 8.4l-4.4 1.6L12 14.8l-1.6-4.8L6 8.4l4.4-1.6L12 2z" />
      <path d="M19 14l.9 2.5L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-1L19 14z" />
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
        "h-3.5 w-3.5 shrink-0 transition-transform",
        open ? "rotate-180" : "",
      ].join(" ")}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
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
