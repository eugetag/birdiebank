import Link from "next/link";
import type { Metadata } from "next";
import ScorecardForm from "./ScorecardForm";

export const metadata: Metadata = {
  title: "Scorecard — Golf Bet Ledger",
  description: "Enter scores hole-by-hole.",
};

export default function ScorecardPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-sand/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-3 sm:px-8 sm:py-4">
          <Link
            href="/bets"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-fairway-700 transition hover:text-fairway-900"
          >
            <span aria-hidden>←</span> Bets
          </Link>
          <span className="text-sm font-medium text-fairway-900/70">
            Scorecard
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fairway-700/80">
            Scoring
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-fairway-900 sm:text-4xl">
            Enter scores
          </h1>
          <p className="text-base leading-relaxed text-fairway-900/70">
            Tap a cell and key in each player&apos;s strokes. Scores save to
            this device automatically as you go.
          </p>
        </div>

        <ScorecardForm />
      </main>
    </div>
  );
}
