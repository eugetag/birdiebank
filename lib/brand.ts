/**
 * User-facing product branding (not database / package names).
 */

import type { RoundDetails } from "./types";

export const APP_NAME = "BirdieBank";
export const TAGLINE = "Keep your golf crew honest.";

export function defaultMemo(details: Pick<RoundDetails, "courseName" | "date">): string {
  return `${APP_NAME} - ${details.courseName} - ${details.date}`;
}
