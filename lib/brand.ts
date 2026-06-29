/**
 * User-facing product branding (not database / package names).
 */

import type { RoundDetails } from "./types";

export const APP_NAME = "TeeTabs";
export const TAGLINE = "Track every bet. Settle every round.";

export function defaultMemo(details: Pick<RoundDetails, "courseName" | "date">): string {
  return `${APP_NAME} - ${details.courseName} - ${details.date}`;
}
