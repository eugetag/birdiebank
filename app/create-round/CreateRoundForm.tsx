"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHasHydrated } from "@/lib/hooks";
import { getDraft } from "@/lib/rounds";
import { saveRoundDetailsOnCreate } from "@/lib/rounds-service";
import { RoundSyncPill } from "@/lib/round-sync-pill";
import type { HoleCount, RoundDetails, RoundSyncState, StartingHole } from "@/lib/types";

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function CreateRoundForm() {
  const hasHydrated = useHasHydrated();

  if (!hasHydrated) {
    return <FormSkeleton />;
  }

  // Safe to read localStorage now — we're past hydration on the client.
  const draft = getDraft();
  return (
    <CreateRoundFormInner
      initial={draft?.details}
      initialRoundSyncState={draft?.roundSyncState}
    />
  );
}

function CreateRoundFormInner({
  initial,
  initialRoundSyncState,
}: {
  initial?: RoundDetails;
  initialRoundSyncState?: RoundSyncState;
}) {
  const router = useRouter();

  const [courseName, setCourseName] = useState(initial?.courseName ?? "");
  const [roundName, setRoundName] = useState(initial?.roundName ?? "");
  const [date, setDate] = useState<string>(initial?.date ?? todayIso());
  const [holes, setHoles] = useState<HoleCount>(initial?.holes ?? 18);
  const [startingHole, setStartingHole] = useState<StartingHole>(
    initial?.startingHole ?? 1,
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roundSyncState, setRoundSyncState] = useState<
    RoundSyncState | undefined
  >(initialRoundSyncState);

  const courseId = useId();
  const roundNameId = useId();
  const dateId = useId();

  const errors = useMemo(() => {
    const e: { courseName?: string; date?: string } = {};
    if (!courseName.trim()) e.courseName = "Add a course name.";
    if (!date) e.date = "Pick a date.";
    return e;
  }, [courseName, date]);

  const canContinue = Object.keys(errors).length === 0;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (!canContinue || saving) return;

    const details: RoundDetails = {
      courseName: courseName.trim(),
      roundName: roundName.trim() ? roundName.trim() : undefined,
      date,
      holes,
      startingHole,
    };

    setSaving(true);
    try {
      const result = await saveRoundDetailsOnCreate(details);
      setRoundSyncState(result.outcome);
      router.push("/players");
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    router.push("/");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <Section title="Round details">
        {roundSyncState ? (
          <div className="flex justify-start">
            <RoundSyncPill state={roundSyncState} />
          </div>
        ) : null}
        <Field
          label="Course name"
          htmlFor={courseId}
          error={touched ? errors.courseName : undefined}
        >
          <input
            id={courseId}
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="e.g. Pine Hollow"
            autoComplete="off"
            inputMode="text"
            className={inputClass(touched && !!errors.courseName)}
          />
        </Field>

        <Field
          label="Round name"
          htmlFor={roundNameId}
          hint="Optional — gives the round a name in your history."
        >
          <input
            id={roundNameId}
            type="text"
            value={roundName}
            onChange={(e) => setRoundName(e.target.value)}
            placeholder="e.g. Sunday Skins with the guys"
            autoComplete="off"
            className={inputClass(false)}
          />
        </Field>

        <Field
          label="Date"
          htmlFor={dateId}
          error={touched ? errors.date : undefined}
        >
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass(touched && !!errors.date)}
          />
        </Field>

        <Field label="Holes">
          <Segmented<HoleCount>
            ariaLabel="Number of holes"
            options={[
              { value: 9, label: "9" },
              { value: 18, label: "18" },
            ]}
            value={holes}
            onChange={setHoles}
          />
        </Field>

        <Field
          label="Starting hole"
          hint="Most rounds begin on 1. Pick 10 for a back-nine start."
        >
          <Segmented<StartingHole>
            ariaLabel="Starting hole"
            options={[
              { value: 1, label: "Hole 1" },
              { value: 10, label: "Hole 10" },
            ]}
            value={startingHole}
            onChange={setStartingHole}
          />
        </Field>
      </Section>

      <ActionBar>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-12 items-center justify-center rounded-full border border-sand bg-white px-5 text-sm font-medium text-fairway-800 transition hover:bg-cream sm:h-11"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!canContinue || saving}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-fairway-700 px-6 text-sm font-medium text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40 sm:h-11 sm:flex-none"
        >
          {saving ? "Saving round…" : "Continue to Players"}
          {!saving ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </ActionBar>
    </form>
  );
}

/* ---------- presentational helpers ---------- */

function FormSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col gap-8"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
        <div className="h-5 w-32 rounded-full bg-cream" />
        <div className="h-12 w-full rounded-xl bg-cream" />
        <div className="h-12 w-full rounded-xl bg-cream" />
        <div className="h-12 w-full rounded-xl bg-cream" />
        <div className="h-12 w-48 rounded-xl bg-cream" />
        <div className="h-12 w-56 rounded-xl bg-cream" />
      </div>
      <div className="h-12 w-full rounded-full bg-cream" />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-sand/70 bg-white p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          {title}
        </h2>
        {description ? (
          <p className="text-sm leading-relaxed text-fairway-900/70">
            {description}
          </p>
        ) : null}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-fairway-900"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-flag">{error}</p>
      ) : hint ? (
        <p className="text-xs text-fairway-900/60">{hint}</p>
      ) : null}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return [
    "h-12 w-full rounded-xl border bg-white px-3.5 text-base text-fairway-900",
    "placeholder:text-fairway-900/40",
    "focus:outline-none focus:ring-2 focus:ring-fairway-500/40 focus:border-fairway-500",
    "transition",
    hasError ? "border-flag/70" : "border-sand",
  ].join(" ");
}

type SegmentedOption<T extends string | number> = {
  value: T;
  label: string;
};

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-xl border border-sand bg-cream p-1"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={[
              "min-w-[88px] rounded-lg px-4 py-2 text-sm font-medium transition",
              active
                ? "bg-fairway-700 text-cream shadow-sm"
                : "text-fairway-800 hover:bg-white",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-3 z-10 -mx-1 flex items-center gap-2 rounded-full border border-sand/70 bg-background/95 p-2 shadow-[0_8px_28px_-12px_rgba(20,32,26,0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
      {children}
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
