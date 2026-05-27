import type { RoundSyncState } from "./types";

const DEFAULT_LABEL: Record<RoundSyncState, string> = {
  cloud: "Round saved to cloud",
  local: "Local fallback",
};

const PALETTE: Record<RoundSyncState, string> = {
  cloud: "border-fairway-600 bg-fairway-700 text-cream",
  local: "border-gold/60 bg-gold/15 text-gold",
};

export function RoundSyncPill({
  state,
  cloudLabel,
  localLabel = DEFAULT_LABEL.local,
}: {
  state: RoundSyncState;
  cloudLabel?: string;
  localLabel?: string;
}) {
  const label =
    state === "cloud"
      ? (cloudLabel ?? DEFAULT_LABEL.cloud)
      : localLabel;

  return (
    <span
      className={[
        "inline-flex h-6 w-fit items-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-wider",
        PALETTE[state],
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      {state === "cloud" ? (
        <CheckIcon className="h-2.5 w-2.5" />
      ) : (
        <CloudOffIcon className="h-2.5 w-2.5" />
      )}
      {label}
    </span>
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
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CloudOffIcon({ className = "" }: { className?: string }) {
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
      <path d="M12 10v4" />
      <path d="M12 16h.01" />
      <path d="M16.5 9.4A5 5 0 0 0 7.2 9.7" />
      <path d="M3.6 15.2A5.5 5.5 0 0 0 10.2 20H18a4 4 0 0 0 .5-7.98" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
