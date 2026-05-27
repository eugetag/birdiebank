import Link from "next/link";
import type { Metadata } from "next";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_NAME } from "@/lib/brand";
import DashboardView from "./DashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your home base for unsettled bets, recent rounds, and history.",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-sand/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-5 py-3 sm:px-8 sm:py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-fairway-700 transition hover:text-fairway-900"
          >
            <BrandLogo className="h-7 w-7 shrink-0" />
            <span className="hidden font-semibold text-fairway-900 sm:inline">
              {APP_NAME}
            </span>
          </Link>
          <span className="text-sm font-semibold text-fairway-900">
            Dashboard
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="inline-flex h-9 items-center justify-center rounded-full border border-sand bg-white px-3 text-sm font-medium text-fairway-800 transition hover:bg-cream"
            >
              Pricing
            </Link>
            <Link
              href="/create-round"
              className="inline-flex items-center gap-1.5 rounded-full bg-fairway-700 px-3 py-2 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.98] sm:px-4"
            >
              New round
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-6 sm:px-8 sm:py-10">
        <DashboardView />
      </main>
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

