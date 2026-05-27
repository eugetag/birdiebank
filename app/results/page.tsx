import Link from "next/link";
import type { Metadata } from "next";
import ResultsView from "./ResultsView";

export const metadata: Metadata = {
  title: "Results — Golf Bet Ledger",
  description: "Settlement summary and per-bet breakdown for the round.",
};

export default function ResultsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-sand/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-3 sm:px-8 sm:py-4">
          <Link
            href="/scorecard"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-fairway-700 transition hover:text-fairway-900"
          >
            <span aria-hidden>←</span> Scorecard
          </Link>
          <span className="text-sm font-medium text-fairway-900/70">
            Results
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fairway-700/80">
            Settlement
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-fairway-900 sm:text-4xl">
            Who owes whom
          </h1>
          <p className="text-base leading-relaxed text-fairway-900/70">
            Here&apos;s the math — copy the summary or start a fresh round.
            We&apos;re just the ledger, we never touch money.
          </p>
        </div>

        <ResultsView />
      </main>
    </div>
  );
}
