import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_NAME, TAGLINE } from "@/lib/brand";

const bets = [
  {
    name: "Skins",
    tagline: "Win a hole outright, win the pot.",
    description:
      "Each hole is worth a skin. Lowest score wins it. Tie the hole and the skin carries over to the next — sometimes one hole decides the day.",
    bullets: [
      "Best for groups that love drama",
      "Carryovers reward streaks",
      "Per-skin value set by the host",
    ],
    accent: "from-fairway-600 to-fairway-700",
  },
  {
    name: "Nassau",
    tagline: "Three bets in one: front, back, total.",
    description:
      "A classic. Settle the front 9, the back 9, and the 18 separately. Add presses when you're down to keep things interesting.",
    bullets: [
      "Front 9, back 9, and overall match",
      "Optional automatic presses",
      "Friendly stakes, friendly rivalries",
    ],
    accent: "from-fairway-500 to-fairway-600",
  },
  {
    name: "Settlement Assistant",
    tagline: "Who owes whom — done in seconds.",
    description:
      "We add up every bet, net out the back-and-forth, and show the smallest number of payments needed to make everyone square.",
    bullets: [
      "Minimised payment graph",
      "Itemised per-bet breakdown",
      "Share the ledger with a tap",
    ],
    accent: "from-gold to-flag",
  },
] as const;

const steps = [
  {
    n: "01",
    title: "Create a round",
    body: "Pick a course, set the date, and you're the host.",
  },
  {
    n: "02",
    title: "Add players",
    body: "Invite friends — guests don't need an account.",
  },
  {
    n: "03",
    title: "Choose your bets",
    body: "Skins, Nassau, or both. Set stakes and presses.",
  },
  {
    n: "04",
    title: "Enter scores, settle up",
    body: "Hole-by-hole entry, then a clean settlement at the end.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1">
        <Hero />
        <BetsSection />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-sand/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3 sm:px-8 sm:py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandLogo className="h-8 w-8 shrink-0" />
          <span className="text-base font-semibold tracking-tight text-fairway-900 sm:text-lg">
            {APP_NAME}
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/pricing"
            className="inline-flex h-9 items-center justify-center rounded-full border border-sand bg-white px-3 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:px-4"
          >
            Pricing
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-full border border-sand bg-white px-3 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:px-4"
          >
            Dashboard
          </Link>
          <Link
            href="/create-round"
            className="inline-flex items-center gap-1.5 rounded-full bg-fairway-700 px-4 py-2 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.98]"
          >
            New round
            <ArrowRight className="h-4 w-4" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-fairway-50 via-background to-background"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-fairway-200/40 blur-3xl"
      />

      <div className="mx-auto w-full max-w-5xl px-5 pt-10 pb-14 sm:px-8 sm:pt-20 sm:pb-24">
        <div className="flex flex-col items-start gap-6 sm:items-center sm:text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-fairway-200 bg-cream px-3 py-1 text-xs font-medium text-fairway-700">
            <span className="h-1.5 w-1.5 rounded-full bg-fairway-500" />
            {TAGLINE}
          </span>

          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-fairway-900 sm:text-5xl md:text-6xl">
            The cleanest way to settle{" "}
            <span className="relative inline-block">
              <span className="relative z-10">golf bets</span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded-sm bg-gold/40 sm:bottom-2 sm:h-4"
              />
            </span>{" "}
            with your foursome.
          </h1>

          <p className="max-w-2xl text-base leading-relaxed text-fairway-900/75 sm:text-lg">
            Set up the round, add your players, pick the bets, and enter scores
            hole-by-hole. {APP_NAME} handles the math and tells you exactly who
            owes whom at the 19th.
          </p>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href="/dashboard"
              className="inline-flex h-12 w-full items-center justify-center rounded-full border border-fairway-200 bg-cream px-6 text-base font-medium text-fairway-800 transition hover:bg-sand/60 sm:w-auto"
            >
              Open dashboard
            </Link>
            <Link
              href="/create-round"
              className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-fairway-700 px-6 text-base font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] sm:w-auto"
            >
              Create round
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#bets"
              className="inline-flex h-12 w-full items-center justify-center rounded-full border border-fairway-200 bg-cream px-6 text-base font-medium text-fairway-800 transition hover:bg-sand/60 sm:w-auto"
            >
              See how bets work
            </a>
          </div>

          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-fairway-900/70 sm:justify-center">
            <li className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-fairway-600" /> Mobile-first
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-fairway-600" /> Guests, no signup
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-fairway-600" /> Settlement only — we never touch money
            </li>
          </ul>
        </div>

        <Scorecard className="mt-12 sm:mt-16" />
      </div>
    </section>
  );
}

function BetsSection() {
  return (
    <section id="bets" className="border-t border-sand/60 bg-cream/40">
      <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="flex flex-col gap-3 sm:items-center sm:text-center">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fairway-700/80">
            The bets we handle
          </span>
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-fairway-900 sm:text-4xl">
            Pick what your group plays. We do the math.
          </h2>
          <p className="max-w-xl text-base text-fairway-900/70">
            Start with the classics. Combine them however you like — every bet
            rolls into one tidy ledger.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-12 md:grid-cols-3">
          {bets.map((bet) => (
            <article
              key={bet.name}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-sand/70 bg-white p-6 shadow-[0_1px_0_rgba(20,32,26,0.04)] transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                aria-hidden
                className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${bet.accent}`}
              />
              <h3 className="text-xl font-semibold tracking-tight text-fairway-900">
                {bet.name}
              </h3>
              <p className="mt-1 text-sm font-medium text-fairway-700">
                {bet.tagline}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-fairway-900/75">
                {bet.description}
              </p>
              <ul className="mt-4 flex flex-col gap-2 text-sm text-fairway-900/80">
                {bet.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-fairway-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-sand/60">
      <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="flex flex-col gap-3 sm:items-center sm:text-center">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-fairway-700/80">
            How it works
          </span>
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-fairway-900 sm:text-4xl">
            Four taps from tee box to settled up.
          </h2>
        </div>

        <ol className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li
              key={step.n}
              className="flex flex-col gap-2 rounded-2xl border border-sand/70 bg-white p-5"
            >
              <span className="font-mono text-sm font-medium text-fairway-700/70">
                {step.n}
              </span>
              <h3 className="text-base font-semibold text-fairway-900">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-fairway-900/70">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex flex-col items-start gap-4 rounded-3xl border border-fairway-200 bg-fairway-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-fairway-900 sm:text-2xl">
              Ready for your next round?
            </h3>
            <p className="mt-1 text-sm text-fairway-900/70 sm:text-base">
              Set it up in under a minute. No signup needed for guests.
            </p>
          </div>
          <Link
            href="/create-round"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fairway-700 px-6 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 sm:w-auto"
          >
            Create round
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-sand/60 bg-cream/50">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-start justify-between gap-3 px-5 py-6 text-sm text-fairway-900/70 sm:flex-row sm:items-center sm:px-8">
        <div className="flex items-center gap-2">
          <BrandLogo className="h-5 w-5 shrink-0" />
          <span>{APP_NAME}</span>
        </div>
        <p className="text-xs">
          {TAGLINE} Settlement assistant only — we do not process payments.
        </p>
      </div>
    </footer>
  );
}

function Scorecard({ className = "" }: { className?: string }) {
  const holes = Array.from({ length: 9 }, (_, i) => i + 1);
  const players = [
    { name: "Host", scores: [4, 5, 3, 4, 4, 5, 3, 4, 4], owed: "+ $14" },
    { name: "Alex", scores: [5, 4, 4, 4, 5, 4, 4, 5, 3], owed: "− $6" },
    { name: "Jordan", scores: [4, 5, 4, 5, 4, 5, 4, 4, 4], owed: "− $8" },
  ];

  return (
    <div
      className={`relative mx-auto w-full max-w-3xl ${className}`}
      aria-hidden
    >
      <div className="overflow-hidden rounded-3xl border border-sand/70 bg-white shadow-[0_20px_60px_-30px_rgba(20,32,26,0.35)]">
        <div className="flex items-center justify-between border-b border-sand/60 bg-cream/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <BrandLogo className="h-5 w-5 shrink-0" />
            <span className="text-sm font-semibold text-fairway-900">
              Saturday at Pine Hollow
            </span>
          </div>
          <span className="rounded-full bg-fairway-100 px-2.5 py-0.5 text-xs font-medium text-fairway-700">
            Live · Front 9
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-fairway-700/70">
                <th className="px-5 py-3 font-medium">Player</th>
                {holes.map((h) => (
                  <th
                    key={h}
                    className="px-2 py-3 text-center font-mono font-medium"
                  >
                    {h}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, idx) => (
                <tr
                  key={p.name}
                  className={idx % 2 === 0 ? "bg-white" : "bg-cream/40"}
                >
                  <td className="px-5 py-3 font-medium text-fairway-900">
                    {p.name}
                  </td>
                  {p.scores.map((s, i) => (
                    <td
                      key={i}
                      className="px-2 py-3 text-center font-mono text-fairway-900/80"
                    >
                      {s}
                    </td>
                  ))}
                  <td
                    className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      p.owed.startsWith("+")
                        ? "text-fairway-700"
                        : "text-flag/90"
                    }`}
                  >
                    {p.owed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-6 left-1/2 h-12 w-[80%] -translate-x-1/2 rounded-full bg-fairway-900/10 blur-2xl"
      />
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

function Check({ className = "" }: { className?: string }) {
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
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
