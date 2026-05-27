/**
 * Parse PostgREST / Supabase errors into a stable shape for UI display.
 */

export type SupabaseErrorDetails = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True only for canonical UUID strings (not local draft ids like `d_…`). */
export function isValidUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return UUID_RE.test(value.trim());
}

/**
 * Supabase `round_id` must be a real uuid or null — never a localStorage draft id.
 */
export function normalizeRoundIdForSupabase(
  roundId: string | undefined | null,
): string | null {
  if (!roundId) return null;
  return isValidUuid(roundId) ? roundId.trim() : null;
}

export function parseSupabaseError(error: unknown): SupabaseErrorDetails {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const message =
      typeof e.message === "string"
        ? e.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      message,
      code: typeof e.code === "string" ? e.code : undefined,
      details: typeof e.details === "string" ? e.details : undefined,
      hint: typeof e.hint === "string" ? e.hint : undefined,
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}
