import Link from "next/link";
import type { Metadata } from "next";
import CreateRoundForm from "./CreateRoundForm";

export const metadata: Metadata = {
  title: "Create round — Golf Bet Ledger",
  description:
    "Step 1 of 3: set up your course, date, hole count, and starting hole.",
};

export default function CreateRoundPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-sand/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-3 sm:px-8 sm:py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-fairway-700 transition hover:text-fairway-900"
          >
            <span aria-hidden>←</span> Home
          </Link>
          <StepIndicator current={1} total={3} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fairway-700/80">
            Step 1 of 3 · Round details
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-fairway-900 sm:text-4xl">
            Create a round
          </h1>
          <p className="text-base leading-relaxed text-fairway-900/70">
            Tell us about the round. You&apos;ll add players and bets next.
          </p>
        </div>

        <CreateRoundForm />
      </main>
    </div>
  );
}

function StepIndicator({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          aria-hidden
          className={[
            "h-1.5 rounded-full transition",
            n === current
              ? "w-6 bg-fairway-700"
              : n < current
                ? "w-3 bg-fairway-500"
                : "w-3 bg-sand",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
