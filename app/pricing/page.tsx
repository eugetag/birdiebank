import Link from "next/link";
import type { Metadata } from "next";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_NAME } from "@/lib/brand";
import PricingView from "./PricingView";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Beta pricing for TeeTabs Free, Birdie Plan, and Founder Beta.",
};

export default function PricingPage() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-sand/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-3 sm:px-8 sm:py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-fairway-700 transition hover:text-fairway-900"
          >
            <BrandLogo className="h-7 w-7 shrink-0" />
            <span className="font-semibold text-fairway-900">{APP_NAME}</span>
          </Link>
          <span className="text-sm font-semibold text-fairway-900">Pricing</span>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-full border border-sand bg-white px-3 text-sm font-medium text-fairway-800 transition hover:bg-cream"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10">
        <div className="relative overflow-hidden rounded-2xl border border-fairway-200/60 bg-gradient-to-br from-fairway-50 via-cream to-background p-6 sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gold/20 blur-2xl"
          />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-fairway-700/80">
            Beta pricing
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fairway-900 sm:text-4xl">
            Play more. Settle smarter.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-fairway-900/75 sm:text-base">
            Choose the plan that fits your group. All tiers are preview-only
            during beta — pick a tier to explore features locally.
          </p>
        </div>

        <PricingView />
      </main>
    </div>
  );
}
