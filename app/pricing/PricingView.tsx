"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHasHydrated } from "@/lib/hooks";
import {
  getSubscriptionTier,
  setSubscriptionTier,
  tierLabel,
  type SubscriptionTier,
} from "@/lib/subscription";

type PlanId = "free" | "birdie" | "founder";

const PLANS: {
  id: PlanId;
  tier: SubscriptionTier;
  name: string;
  subtitle?: string;
  price: string;
  priceNote?: string;
  badge?: string;
  badgeVariant?: "popular" | "limited";
  featured?: boolean;
  features: string[];
  cta: string;
}[] = [
  {
    id: "free",
    tier: "free",
    name: "TeeTabs Free",
    price: "$0",
    features: [
      "4 rounds per month",
      "All core bet types",
      "Manual score entry",
      "Paper scorecard upload",
      "Basic settlement assistant",
      "Local ledger only",
      "Limited player history",
      "No cloud sync",
      "No dashboard history",
    ],
    cta: "Continue Free",
  },
  {
    id: "birdie",
    tier: "birdie",
    name: "Birdie Plan",
    subtitle: "Recommended",
    price: "$2.99",
    priceNote: "USD/month · $24.99 USD/year",
    badge: "Most Popular",
    badgeVariant: "popular",
    featured: true,
    features: [
      "Unlimited rounds",
      "Cloud ledger",
      "Running balances",
      "Previous unsettled bets",
      "Dashboard",
      "Notification history",
      "Player auto-recognition",
      "Cloud sync",
      "Unlimited player history",
    ],
    cta: "Join Beta",
  },
  {
    id: "founder",
    tier: "founder",
    name: "Founder Beta",
    price: "$14.99",
    priceNote: "Lifetime",
    badge: "Limited First 250 Users",
    badgeVariant: "limited",
    features: [
      "Lifetime Birdie access",
      "Founder badge",
      "Early access",
      "Future premium features included",
    ],
    cta: "Become Founder",
  },
];

export default function PricingView() {
  const hasHydrated = useHasHydrated();

  if (!hasHydrated) {
    return <PricingPlansSkeleton />;
  }

  return <PricingPlans />;
}

function PricingPlans() {
  const router = useRouter();
  const [currentTier, setCurrentTier] = useState<SubscriptionTier>(() =>
    getSubscriptionTier(),
  );

  function selectPlan(tier: SubscriptionTier) {
    setSubscriptionTier(tier);
    setCurrentTier(tier);
    router.push(tier === "free" ? "/" : "/create-round");
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="rounded-xl border border-sand/70 bg-cream/50 px-4 py-3 text-center text-sm text-fairway-900/80">
        Current plan:{" "}
        <span className="font-semibold text-fairway-900">
          {tierLabel(currentTier)}
        </span>
        <span className="text-fairway-900/50"> · Beta preview — no charge</span>
      </p>

      <div className="flex flex-col gap-5">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrent={currentTier === plan.tier}
            onSelect={() => selectPlan(plan.tier)}
          />
        ))}
      </div>

      <p className="text-center text-xs leading-relaxed text-fairway-900/60">
        Pricing shown for beta planning only. No payment processing is connected
        yet.
      </p>
    </div>
  );
}

function PricingPlansSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="h-14 rounded-xl bg-cream/80" />
      <div className="h-64 rounded-2xl bg-cream/80" />
      <div className="h-72 rounded-2xl bg-cream/80" />
      <div className="h-56 rounded-2xl bg-cream/80" />
    </div>
  );
}

function PlanCard({
  plan,
  isCurrent,
  onSelect,
}: {
  plan: (typeof PLANS)[number];
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const featured = plan.featured;

  return (
    <article
      className={[
        "relative flex flex-col gap-4 rounded-2xl border p-5 sm:p-6",
        featured
          ? "border-fairway-600/40 bg-gradient-to-b from-fairway-50 via-white to-white shadow-[0_12px_40px_-16px_rgba(28,74,35,0.25)] ring-1 ring-fairway-600/20"
          : "border-sand/70 bg-white",
      ].join(" ")}
    >
      {plan.badge ? (
        <span
          className={[
            "absolute -top-3 left-5 inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-wider",
            plan.badgeVariant === "popular"
              ? "border-fairway-600 bg-fairway-700 text-cream"
              : "border-gold/50 bg-gold/20 text-gold",
          ].join(" ")}
        >
          {plan.badge}
        </span>
      ) : null}

      <header className="flex flex-col gap-1 pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
            {plan.name}
          </h2>
          {plan.subtitle ? (
            <span className="text-gold" aria-label="Recommended">
              ⭐
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-2xl font-semibold tabular-nums text-fairway-900">
            {plan.price}
          </span>
          {plan.priceNote ? (
            <span className="text-sm text-fairway-900/60">{plan.priceNote}</span>
          ) : null}
        </div>
      </header>

      <ul className="flex flex-col gap-2 border-t border-sand/60 pt-4">
        {plan.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-sm text-fairway-900/90"
          >
            <span
              className={[
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                featured ? "bg-fairway-600" : "bg-fairway-400",
              ].join(" ")}
              aria-hidden
            />
            {feature}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onSelect}
        disabled={isCurrent}
        className={[
          "mt-1 inline-flex h-12 w-full items-center justify-center rounded-full text-sm font-medium transition active:scale-[0.99] disabled:cursor-default",
          featured
            ? "bg-fairway-700 text-cream shadow-sm hover:bg-fairway-600 disabled:bg-fairway-700/50"
            : "border border-sand bg-cream text-fairway-800 hover:bg-white disabled:opacity-60",
        ].join(" ")}
      >
        {isCurrent ? "Current plan" : plan.cta}
      </button>
    </article>
  );
}
