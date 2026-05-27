"use client";

import Link from "next/link";
import { PAYWALL_ENFORCEMENT_ENABLED } from "@/lib/subscription";

const UPGRADE_BULLETS = [
  "Unlimited rounds",
  "Cloud ledger",
  "Previous unsettled bets",
  "Dashboard history",
] as const;

type RoundLimitPaywallModalProps = {
  open: boolean;
  onContinueLater: () => void;
};

export function RoundLimitPaywallModal({
  open,
  onContinueLater,
}: RoundLimitPaywallModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-fairway-900/50 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onContinueLater}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-sand/80 bg-white shadow-[0_24px_64px_-16px_rgba(15,41,20,0.35)]">
        <div
          aria-hidden
          className="h-1.5 bg-gradient-to-r from-fairway-600 via-gold to-fairway-500"
        />
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <header className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
              Monthly limit
            </span>
            <h2
              id="paywall-title"
              className="text-xl font-semibold tracking-tight text-fairway-900"
            >
              You&apos;ve reached 4 rounds this month.
            </h2>
            <p className="text-sm leading-relaxed text-fairway-900/70">
              Upgrade to Birdie Plan for:
            </p>
          </header>

          <ul className="flex flex-col gap-2">
            {UPGRADE_BULLETS.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-fairway-900"
              >
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-fairway-600" />
                {item}
              </li>
            ))}
          </ul>

          {!PAYWALL_ENFORCEMENT_ENABLED ? (
            <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-center text-xs font-medium text-gold">
              Enforcement disabled in beta
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/pricing"
              className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-fairway-700 px-5 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600"
            >
              View Pricing
            </Link>
            <button
              type="button"
              onClick={onContinueLater}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream"
            >
              Continue Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
