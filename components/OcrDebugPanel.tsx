"use client";

import type { OcrDebugState } from "@/lib/scorecard-analysis";

export type { OcrDebugState };

export function OcrDebugPanel({ debug }: { debug: OcrDebugState }) {
  const rawJsonText =
    debug.rawJson !== undefined && debug.rawJson !== null
      ? JSON.stringify(debug.rawJson, null, 2)
      : debug.rawResponse ?? "(none)";

  return (
    <details className="rounded-2xl border border-sand/80 bg-cream/30 open:bg-cream/50">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fairway-900 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <ChevronIcon className="h-4 w-4 text-fairway-700" />
          OCR Debug
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-sand/60 px-4 pb-4 pt-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80">
            Image sent to OCR
          </h3>
          <div className="flex justify-center rounded-xl border border-sand bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={debug.imageDataUrl}
              alt="Scorecard image used for OCR"
              className="max-h-48 w-auto rounded-lg object-contain"
            />
          </div>
        </div>

        <DebugField label="Error message" value={debug.error ?? "—"} mono />
        <DebugField
          label="AI response"
          value={debug.aiResponseSummary ?? debug.rawResponse ?? "—"}
          mono
        />
        <DebugField
          label="Confidence"
          value={debug.confidence ?? "—"}
        />
        <DebugField
          label="Notes"
          value={
            debug.notes.length > 0 ? debug.notes.join("\n") : "—"
          }
        />
        <DebugField
          label="Extracted player names"
          value={
            debug.extractedPlayerNames.length > 0
              ? debug.extractedPlayerNames.join(", ")
              : "—"
          }
        />
        <DebugField label="Raw JSON returned" value={rawJsonText} mono block />
      </div>
    </details>
  );
}

function DebugField({
  label,
  value,
  mono = false,
  block = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  block?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-fairway-700/80">
        {label}
      </span>
      <pre
        className={[
          "overflow-x-auto rounded-lg border border-sand/70 bg-white px-3 py-2 text-xs text-fairway-900",
          mono ? "font-mono whitespace-pre-wrap break-all" : "whitespace-pre-wrap",
          block ? "max-h-64" : "",
        ].join(" ")}
      >
        {value}
      </pre>
    </div>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
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
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
