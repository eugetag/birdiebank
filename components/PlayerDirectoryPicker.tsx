"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { formatMoney } from "@/lib/payments";
import {
  contactLabel,
  filterDirectoryPickerEntries,
  loadPlayerDirectoryForPicker,
  type DirectoryPickerEntry,
} from "@/lib/player-directory-service";
import type { Currency, DirectoryEntry, LedgerEntry } from "@/lib/types";

type PlayerDirectoryPickerProps = {
  open: boolean;
  onClose: () => void;
  ledger: LedgerEntry[];
  usedContactKeys: ReadonlySet<string>;
  usedNames: ReadonlySet<string>;
  atCapacity: boolean;
  onAdd: (entry: DirectoryEntry) => { ok: true } | { ok: false; message: string };
};

export function PlayerDirectoryPicker({
  open,
  onClose,
  ledger,
  usedContactKeys,
  usedNames,
  atCapacity,
  onAdd,
}: PlayerDirectoryPickerProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<"cloud" | "local" | null>(null);
  const [entries, setEntries] = useState<DirectoryPickerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAddError(null);
    setError(null);
    setLoading(true);
    void loadPlayerDirectoryForPicker(ledger).then((result) => {
      setOutcome(result.outcome);
      setEntries(result.players);
      setLoading(false);
      if (result.players.length === 0 && result.outcome === "local") {
        setError("No saved players yet. Add players manually or from results.");
      }
    });
  }, [open, ledger]);

  const filtered = useMemo(
    () => filterDirectoryPickerEntries(entries, query),
    [entries, query],
  );

  if (!open) return null;

  function handleAdd(entry: DirectoryPickerEntry) {
    setAddError(null);
    const result = onAdd(entry);
    if (!result.ok) {
      setAddError(result.message);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-fairway-900/50 backdrop-blur-[2px]"
        aria-label="Close player directory"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-directory-title"
        className="relative z-10 flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-sand/80 bg-white shadow-[0_24px_64px_-16px_rgba(15,41,20,0.35)] sm:rounded-2xl"
      >
        <header className="flex shrink-0 flex-col gap-3 border-b border-sand/70 px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2
                id="player-directory-title"
                className="text-lg font-semibold tracking-tight text-fairway-900"
              >
                Player Directory
              </h2>
              <p className="text-xs text-fairway-900/65">
                Add someone you&apos;ve played with before.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sand text-fairway-700 transition hover:bg-cream"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {outcome ? (
            <span
              className={[
                "self-start inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
                outcome === "cloud"
                  ? "border-fairway-300 bg-fairway-100 text-fairway-700"
                  : "border-gold/40 bg-gold/15 text-gold",
              ].join(" ")}
            >
              {outcome === "cloud" ? "Saved to cloud" : "Local fallback"}
            </span>
          ) : null}
          <label htmlFor={searchId} className="sr-only">
            Search players
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, or phone"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-sand bg-cream/40 px-3.5 text-base text-fairway-900 placeholder:text-fairway-900/40 focus:border-fairway-500 focus:outline-none focus:ring-2 focus:ring-fairway-500/40"
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3 sm:px-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-fairway-900/60">
              Loading directory…
            </p>
          ) : error ? (
            <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-6 text-center text-sm text-fairway-900/70">
              {error}
            </p>
          ) : filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-6 text-center text-sm text-fairway-900/70">
              {query.trim()
                ? "No players match your search."
                : "No players in the directory yet."}
            </p>
          ) : (
            filtered.map((entry) => (
              <DirectoryPlayerCard
                key={entry.normalizedContactKey}
                entry={entry}
                alreadyInRound={isAlreadyInRound(
                  entry,
                  usedContactKeys,
                  usedNames,
                )}
                atCapacity={atCapacity}
                onAdd={() => handleAdd(entry)}
              />
            ))
          )}
        </div>

        {addError ? (
          <p className="shrink-0 border-t border-sand/70 px-4 py-2 text-sm text-flag sm:px-5">
            {addError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function isAlreadyInRound(
  entry: DirectoryPickerEntry,
  usedContactKeys: ReadonlySet<string>,
  usedNames: ReadonlySet<string>,
): boolean {
  if (usedContactKeys.has(entry.normalizedContactKey)) return true;
  return usedNames.has(entry.displayName.trim().toLowerCase());
}

function DirectoryPlayerCard({
  entry,
  alreadyInRound,
  atCapacity,
  onAdd,
}: {
  entry: DirectoryPickerEntry;
  alreadyInRound: boolean;
  atCapacity: boolean;
  onAdd: () => void;
}) {
  const balance = formatNetBalance(entry.netBalance);
  const disabled = alreadyInRound || atCapacity;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-sand/70 bg-cream/30 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-fairway-900">
            {entry.displayName}
          </h3>
          {entry.preferredMethod ? (
            <span className="rounded-full border border-fairway-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fairway-700">
              {entry.preferredMethod}
            </span>
          ) : null}
          {alreadyInRound ? (
            <span className="rounded-full border border-flag/30 bg-flag/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-flag">
              In round
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-fairway-900/70">
          {contactLabel(entry)}
        </p>
        <p className="text-[11px] text-fairway-900/60">
          {balance ? (
            <>
              <span className="font-medium text-fairway-900">{balance}</span>
              {entry.unsettledRounds > 0
                ? ` · ${entry.unsettledRounds} unsettled round${entry.unsettledRounds === 1 ? "" : "s"}`
                : ""}
            </>
          ) : (
            "No outstanding balance on file"
          )}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onAdd}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-fairway-700 px-4 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 disabled:cursor-not-allowed disabled:bg-fairway-700/40"
      >
        Add Player
      </button>
    </article>
  );
}

function formatNetBalance(net: DirectoryPickerEntry["netBalance"]): string | null {
  const parts: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    const v = net[c];
    if (Math.abs(v) < 0.005) continue;
    const sign = v > 0 ? "owes " : "owed ";
    parts.push(`${sign}${formatMoney(Math.abs(v), c)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}
