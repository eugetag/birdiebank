"use client";

/**
 * Temporary diagnostic page: /supabase-test
 *
 * Three sections, top to bottom:
 *   1. Env diagnostics  — shows whether the NEXT_PUBLIC_SUPABASE_* vars
 *      are set. Reveals the URL host only; the anon key is never displayed.
 *   2. Connectivity     — runs `select("*", { count: "exact" }).limit(5)`
 *      on mount and reports the count + a small row sample, or a
 *      structured error (name, message, code, details, hint).
 *   3. Insert test       — upsert one fixed row into `players` keyed by
 *      `normalized_contact_key`. Same structured error display on failure.
 *
 * The `supabase` client is imported statically — `lib/supabase/client.ts`
 * is the only place that calls `createClient` and never appends a path,
 * so this import is safe as long as the env vars are set.
 */

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ */
/*  Shared error model                                                 */
/* ------------------------------------------------------------------ */

type ErrorInfo = {
  name: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  /**
   * True when no Supabase HTTP response was parsed — env vars missing,
   * fetch threw (CORS / DNS / offline), or any other pre-response failure.
   */
  fetchFailedBeforeResponse: boolean;
};

function looksLikePostgrestError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  if (e.name === "PostgrestError") return true;
  return (
    typeof e.code === "string" ||
    typeof e.details === "string" ||
    typeof e.hint === "string"
  );
}

function thrownToErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof Error) {
    return {
      name: err.name || "Error",
      message: err.message,
      fetchFailedBeforeResponse: true,
    };
  }
  return {
    name: "UnknownError",
    message: String(err),
    fetchFailedBeforeResponse: true,
  };
}

function postgrestToErrorInfo(error: {
  name?: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}): ErrorInfo {
  return {
    name: error.name || "PostgrestError",
    message: error.message,
    code: error.code || undefined,
    details: error.details || undefined,
    hint: error.hint || undefined,
    fetchFailedBeforeResponse: !looksLikePostgrestError(error),
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type Status =
  | { kind: "loading" }
  | { kind: "ok"; count: number | null; sampleSize: number }
  | { kind: "error"; info: ErrorInfo };

export default function SupabaseTestPage() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error, count } = await supabase
          .from("players")
          .select("*", { count: "exact" })
          .limit(5);
        if (cancelled) return;
        if (error) {
          setStatus({ kind: "error", info: postgrestToErrorInfo(error) });
          return;
        }
        setStatus({
          kind: "ok",
          count: typeof count === "number" ? count : null,
          sampleSize: Array.isArray(data) ? data.length : 0,
        });
      } catch (err) {
        if (cancelled) return;
        setStatus({ kind: "error", info: thrownToErrorInfo(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-5 py-10">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Diagnostic
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-fairway-900">
          Supabase Test
        </h1>
        <p className="text-sm text-fairway-900/70">
          Connectivity + write test for the{" "}
          <code className="font-mono">players</code> table. Safe to delete
          once the migration is in flight.
        </p>
      </header>

      <EnvDiagnosticsCard />

      {status.kind === "loading" ? <LoadingCard /> : null}
      {status.kind === "ok" ? (
        <ConnectedCard count={status.count} sampleSize={status.sampleSize} />
      ) : null}
      {status.kind === "error" ? (
        <ConnectionErrorCard info={status.info} />
      ) : null}

      <InsertTestPlayerCard />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Env diagnostics                                                    */
/* ------------------------------------------------------------------ */

/**
 * `NEXT_PUBLIC_*` is inlined into the client bundle at build time, so
 * reading at module level is equivalent to reading during render. We
 * deliberately keep the anon key as a presence boolean and never read
 * its bytes into any rendered string.
 */
const ENV_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ENV_HAS_KEY = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim(),
);

function urlHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function EnvDiagnosticsCard() {
  const hasUrl = Boolean(ENV_URL && ENV_URL.trim());
  const host = urlHost(ENV_URL);
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border border-sand bg-cream/40 p-5"
      aria-label="Supabase environment diagnostics"
    >
      <header className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Environment
        </span>
        <h2 className="text-base font-semibold tracking-tight text-fairway-900">
          Configuration
        </h2>
        <p className="text-xs text-fairway-900/70">
          Build-time values inlined into the client bundle. Secrets are
          deliberately not rendered.
        </p>
      </header>
      <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-xs">
        <DiagRow
          label="Supabase URL exists"
          value={<YesNo value={hasUrl} />}
        />
        <DiagRow
          label="Supabase URL host"
          value={
            host ? (
              <span className="font-mono text-fairway-900">{host}</span>
            ) : (
              <span className="text-fairway-900/50">—</span>
            )
          }
        />
        <DiagRow
          label="Anon key exists"
          value={<YesNo value={ENV_HAS_KEY} />}
        />
      </dl>
    </section>
  );
}

function DiagRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <>
      <dt className="font-semibold uppercase tracking-wider text-fairway-700/80">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-fairway-900/90">{value}</dd>
    </>
  );
}

function YesNo({ value }: { value: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        value
          ? "border-fairway-600 bg-fairway-700 text-cream"
          : "border-rose-300 bg-rose-50 text-rose-700",
      ].join(" ")}
    >
      {value ? "yes" : "no"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Connectivity check                                                 */
/* ------------------------------------------------------------------ */

function LoadingCard() {
  return (
    <div
      className="rounded-2xl border border-sand bg-cream/40 p-5 text-sm text-fairway-900/70"
      role="status"
      aria-live="polite"
    >
      Checking connection…
    </div>
  );
}

function ConnectedCard({
  count,
  sampleSize,
}: {
  count: number | null;
  sampleSize: number;
}) {
  return (
    <div
      className="rounded-2xl border border-fairway-300 bg-fairway-100 p-5"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700">
        Supabase Connected
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-fairway-900">
        {count !== null ? count.toLocaleString() : "—"}{" "}
        <span className="text-base font-medium text-fairway-900/70">
          {count === 1 ? "player" : "players"}
        </span>
      </p>
      <p className="mt-2 text-xs text-fairway-900/70">
        Exact count from <code className="font-mono">players</code>; first{" "}
        {sampleSize} row{sampleSize === 1 ? "" : "s"} returned.
      </p>
    </div>
  );
}

function ConnectionErrorCard({ info }: { info: ErrorInfo }) {
  return (
    <section
      className="rounded-2xl border border-rose-300 bg-rose-50 p-5"
      role="alert"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
        Connection Error
      </p>
      <ErrorPanel info={info} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Insert Test Player                                                 */
/* ------------------------------------------------------------------ */

type InsertState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; rowCount: number }
  | { kind: "error"; info: ErrorInfo };

function InsertTestPlayerCard() {
  const [state, setState] = useState<InsertState>({ kind: "idle" });

  async function handleClick() {
    setState({ kind: "running" });
    try {
      const { data, error } = await supabase
        .from("players")
        .upsert(
          {
            display_name: "Test Player",
            email: "test@example.com",
            normalized_contact_key: "test@example.com",
            country: "Canada",
            preferred_method: "Interac e-Transfer",
          },
          { onConflict: "normalized_contact_key" },
        )
        .select();
      if (error) {
        setState({ kind: "error", info: postgrestToErrorInfo(error) });
        return;
      }
      setState({
        kind: "success",
        rowCount: Array.isArray(data) ? data.length : 0,
      });
    } catch (err) {
      setState({ kind: "error", info: thrownToErrorInfo(err) });
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-sand bg-white p-5">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700/80">
          Diagnostic
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-fairway-900">
          Insert Test Player
        </h2>
        <p className="text-xs text-fairway-900/70">
          Upserts one row into <code className="font-mono">players</code> keyed
          by <code className="font-mono">normalized_contact_key</code>. Safe to
          run repeatedly — re-clicking refreshes the same row instead of
          inserting duplicates.
        </p>
      </header>

      <button
        type="button"
        onClick={handleClick}
        disabled={state.kind === "running"}
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-fairway-700 px-4 text-sm font-semibold text-cream shadow-sm transition hover:bg-fairway-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-fairway-700/40 sm:w-auto"
      >
        {state.kind === "running" ? "Inserting…" : "Insert Test Player"}
      </button>

      {state.kind === "success" ? (
        <InsertSuccessCard rowCount={state.rowCount} />
      ) : null}
      {state.kind === "error" ? <InsertErrorCard info={state.info} /> : null}
    </section>
  );
}

function InsertSuccessCard({ rowCount }: { rowCount: number }) {
  return (
    <div
      className="rounded-xl border border-fairway-300 bg-fairway-100 p-4"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fairway-700">
        Success
      </p>
      <p className="mt-1 text-sm text-fairway-900">
        Upserted {rowCount} row{rowCount === 1 ? "" : "s"} into{" "}
        <code className="font-mono">players</code>.
      </p>
    </div>
  );
}

function InsertErrorCard({ info }: { info: ErrorInfo }) {
  return (
    <div
      className="rounded-xl border border-rose-300 bg-rose-50 p-4"
      role="alert"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
        Error
      </p>
      <ErrorPanel info={info} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared error renderer                                              */
/* ------------------------------------------------------------------ */

function ErrorPanel({ info }: { info: ErrorInfo }) {
  return (
    <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-xs text-rose-900">
      <ErrRow label="Name" value={info.name} mono />
      <ErrRow label="Message" value={info.message} mono />
      <ErrRow
        label="Fetch failed before response"
        value={info.fetchFailedBeforeResponse ? "yes" : "no"}
      />
      {info.code ? <ErrRow label="Code" value={info.code} mono /> : null}
      {info.details ? (
        <ErrRow label="Details" value={info.details} mono />
      ) : null}
      {info.hint ? <ErrRow label="Hint" value={info.hint} mono /> : null}
    </dl>
  );
}

function ErrRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="font-semibold uppercase tracking-wider text-rose-700/80">
        {label}
      </dt>
      <dd
        className={[
          "min-w-0 break-words",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </>
  );
}
