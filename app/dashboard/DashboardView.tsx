"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useHasHydrated } from "@/lib/hooks";
import { APP_NAME } from "@/lib/brand";
import { formatMoney } from "@/lib/payments";
import { loadDashboardData, type DashboardData } from "@/lib/dashboard-service";
import type { CurrencyBag } from "@/lib/ledger";
import type { Currency } from "@/lib/types";

const CURRENCIES: Currency[] = ["CAD", "USD"];

export default function DashboardView() {
  const hasHydrated = useHasHydrated();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    let cancelled = false;
    (async () => {
      const loaded = await loadDashboardData();
      if (!cancelled) setData(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasHydrated]);

  if (!hasHydrated) {
    return <Skeleton />;
  }
  if (!data) {
    return <Skeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <QuickActions />

      <section
        id="unsettled"
        className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6 scroll-mt-24"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
              Unsettled Bets
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
              Unsettled Bets Summary
            </h2>
            <p className="text-xs text-fairway-900/70">
              Pending and disputed debts pulled from Supabase when available.
            </p>
          </div>
          {data.outcome === "local" ? <LocalFallbackPill /> : null}
        </header>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Outstanding"
            value={currencyBagToString(data.unsettledSummary.outstanding)}
          />
          <Stat
            label="Pending debts"
            value={`${data.unsettledSummary.pendingCount}`}
          />
          <Stat
            label="Players who owe"
            value={`${data.unsettledSummary.payers}`}
          />
          <Stat
            label="Players owed"
            value={`${data.unsettledSummary.receivers}`}
          />
        </dl>

        {data.unsettledEntries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-4 text-center text-sm text-fairway-900/70">
            No unsettled debts found.
          </p>
        ) : (
          <Link
            href="/results"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-sand bg-cream/40 px-4 text-sm font-medium text-fairway-800 transition hover:bg-cream"
          >
            View Unsettled Bets
          </Link>
        )}
      </section>

      <section
        id="recent-rounds"
        className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6 scroll-mt-24"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
              Rounds
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
              Recent Rounds
            </h2>
            <p className="text-xs text-fairway-900/70">
              Latest round metadata from Supabase (or local history).
            </p>
          </div>
          {data.outcome === "local" ? <LocalFallbackPill /> : null}
        </header>

        {data.recentRounds.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-4 text-center text-sm text-fairway-900/70">
            No rounds yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.recentRounds.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border border-sand bg-cream/30 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-fairway-900">
                      {r.courseName}
                    </div>
                    <div className="text-xs text-fairway-900/70">
                      {r.date}
                      {r.roundName ? ` · ${r.roundName}` : ""} · {r.holes} holes
                    </div>
                  </div>
                  <Link
                    href={r.supabaseRoundId ? "/results" : "/create-round"}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-sand bg-white px-3 text-xs font-semibold text-fairway-700 transition hover:bg-cream"
                  >
                    {r.supabaseRoundId ? "View Results" : "Start Similar"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
              Notifications
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
              Notification History
            </h2>
            <p className="text-xs text-fairway-900/70">
              Logged previews and sent markers. {APP_NAME} never sends
              messages.
            </p>
          </div>
          {data.outcome === "local" ? <LocalFallbackPill /> : null}
        </header>

        {data.notificationHistory.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-4 text-center text-sm text-fairway-900/70">
            No notification history yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.notificationHistory.map((n) => (
              <li
                key={n.id}
                className="flex flex-col gap-1.5 rounded-xl border border-sand bg-cream/30 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-fairway-900/70">
                    {n.date ?? "—"}
                    {n.courseName ? ` · ${n.courseName}` : ""}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Pill label={n.type} variant={n.type === "email" ? "green" : "gold"} />
                    <Pill label={n.status} variant={n.status === "sent" ? "greenSolid" : "gold"} />
                  </div>
                </div>
                <div className="text-xs text-fairway-900/80">{n.message}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
              Players
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
              Player Directory Preview
            </h2>
            <p className="text-xs text-fairway-900/70">
              Recent players with preferred payment methods and net outstanding.
            </p>
          </div>
          {data.outcome === "local" ? <LocalFallbackPill /> : null}
        </header>

        {data.playerDirectory.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sand bg-cream/40 px-3 py-4 text-center text-sm text-fairway-900/70">
            No players yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.playerDirectory.map((p) => (
              <li
                key={p.contactKey}
                className="flex items-start justify-between gap-3 rounded-xl border border-sand bg-cream/30 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fairway-900">
                    {p.name}
                  </div>
                  <div className="truncate text-xs text-fairway-900/70">
                    {p.preferredMethod ? `Preferred: ${p.preferredMethod}` : "No preferred method"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-fairway-700/70">
                    Net
                  </div>
                  <div className="font-mono text-xs font-semibold tabular-nums text-fairway-900">
                    {signedCurrencyBagToString(p.net)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QuickActions() {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand/70 bg-cream/40 p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Quick Actions
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          Jump in
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ActionLink href="/create-round" label="Start New Round" />
        <ActionLink href="#unsettled" label="View Unsettled Bets" />
        <ActionLink href="#recent-rounds" label="View Recent Rounds" />
      </div>
    </section>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center justify-center rounded-xl bg-fairway-700 px-4 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99]"
    >
      {label}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-sand bg-cream/30 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-fairway-700/70">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-fairway-900">
        {value}
      </dd>
    </div>
  );
}

function Pill({
  label,
  variant,
}: {
  label: string;
  variant: "green" | "gold" | "greenSolid";
}) {
  const palette =
    variant === "greenSolid"
      ? "border-fairway-700 bg-fairway-700 text-cream"
      : variant === "green"
        ? "border-fairway-300 bg-fairway-100 text-fairway-700"
        : "border-gold/40 bg-gold/15 text-gold";
  return (
    <span
      className={[
        "inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        palette,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function currencyBagToString(bag: CurrencyBag): string {
  const parts = CURRENCIES.map((c) => (Math.abs(bag[c]) >= 0.005 ? formatMoney(bag[c], c) : null)).filter(
    (x): x is string => !!x,
  );
  return parts.length ? parts.join(" · ") : "—";
}

function signedCurrencyBagToString(bag: CurrencyBag): string {
  const parts = CURRENCIES.map((c) => {
    const v = bag[c];
    if (Math.abs(v) < 0.005) return null;
    const sign = v > 0 ? "+" : "−";
    return `${sign}${formatMoney(Math.abs(v), c)}`;
  }).filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : "Settled";
}

function LocalFallbackPill() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-gold/60 bg-gold/15 px-2 text-[10px] font-semibold uppercase tracking-wider text-gold">
      Local fallback
    </span>
  );
}

function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="h-32 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-48 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-56 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-56 rounded-2xl border border-sand/70 bg-cream/60" />
      <div className="h-56 rounded-2xl border border-sand/70 bg-cream/60" />
    </div>
  );
}

