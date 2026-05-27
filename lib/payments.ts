/**
 * Settlement Assistant helpers.
 *
 * BirdieBank never processes payments — these helpers only derive
 * friendly "send the money here" instructions from the per-player payment
 * profile and the round metadata, plus stable keys for tracking statuses.
 */

import { defaultMemo } from "./brand";
import type {
  Country,
  Currency,
  PaymentMethod,
  PaymentProfile,
  Player,
  RoundDetails,
  SettlementTransaction,
} from "./types";

/** All payment methods supported in the UI, in display order. */
export const PAYMENT_METHODS: PaymentMethod[] = [
  "Interac e-Transfer",
  "Venmo",
  "Cash App",
  "PayPal",
  "Zelle",
  "Cash",
  "Other",
];

/**
 * Methods that are appropriate for a given country.
 * "Other" always gets the full list — host can pick whatever.
 */
export function methodsForCountry(
  country: PaymentProfile["country"],
): PaymentMethod[] {
  if (country === "Canada") {
    return ["Interac e-Transfer", "Cash", "PayPal", "Other"];
  }
  if (country === "United States") {
    return ["Venmo", "Cash App", "Zelle", "PayPal", "Cash", "Other"];
  }
  return [...PAYMENT_METHODS];
}

export type PaymentInstruction = {
  /** Display name e.g. "Interac e-Transfer". */
  methodLabel: string;
  /** Where to send (email, handle, link). Null when no info on file. */
  destination: string | null;
  /** Memo for the recipient. */
  memo: string;
  /** True iff the payee has any profile data we can use. */
  hasProfile: boolean;
  /** True iff we have an actual contact field for the chosen method. */
  hasContact: boolean;
};

export function buildPaymentInstruction(
  payee: Player,
  amount: number,
  details: RoundDetails,
): PaymentInstruction {
  const profile = payee.paymentProfile;
  const memo = buildMemo(details);

  if (!profile) {
    return {
      methodLabel: "No payment info on file",
      destination: null,
      memo,
      hasProfile: false,
      hasContact: false,
    };
  }

  const destination = deriveDestination(profile);
  return {
    methodLabel: profile.preferredMethod,
    destination,
    memo,
    hasProfile: true,
    hasContact: destination !== null,
  };
}

function deriveDestination(profile: PaymentProfile): string | null {
  switch (profile.preferredMethod) {
    case "Interac e-Transfer":
      return firstNonEmpty(profile.interacEmail, profile.interacPhone);
    case "Venmo":
      return profile.venmoHandle
        ? `@${stripLeading(profile.venmoHandle, "@")}`
        : null;
    case "Cash App":
      return profile.cashAppTag
        ? `$${stripLeading(profile.cashAppTag, "$")}`
        : null;
    case "PayPal":
      return firstNonEmpty(profile.paypalLink);
    case "Zelle":
      return firstNonEmpty(profile.zelleEmail, profile.zellePhone);
    case "Cash":
      // Cash has no "destination" address — it's exchanged in person.
      return "In person";
    case "Other":
      return firstNonEmpty(profile.notes);
  }
}

/**
 * Memo emitted on every payment instruction and ledger entry.
 * We keep the date in ISO `YYYY-MM-DD` form so it's unambiguous across
 * locales and matches the example in the settlement-assistant spec exactly.
 */
export function buildMemo(details: RoundDetails): string {
  return defaultMemo(details);
}

/** Default currency for a receiver based on their stored country. */
export function currencyForCountry(country: Country | undefined): Currency {
  if (country === "United States") return "USD";
  // Canada and "Other" both default to CAD per spec.
  return "CAD";
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function stripLeading(value: string, char: string): string {
  let v = value.trim();
  while (v.startsWith(char)) v = v.slice(1);
  return v;
}

/** Stable key for the settlement-status map. */
export function settlementKey(t: SettlementTransaction): string {
  return `${t.fromId}->${t.toId}`;
}

/**
 * Plain-text block to copy onto the clipboard for a single transaction.
 * Matches the format from the settlement-assistant spec:
 *
 *   Mike owes John $25 CAD
 *   Preferred payment: Interac e-Transfer
 *   Send to: john@email.com
 *   Memo: BirdieBank - Blue Devil - 2026-05-25
 *
 * If the payee has no usable payment method on file, the second/third
 * lines are replaced with a single explanatory line.
 */
export function formatInstructionText(args: {
  payerName: string;
  payeeName: string;
  amount: number;
  currency: Currency;
  instruction: PaymentInstruction;
}): string {
  const { payerName, payeeName, amount, currency, instruction } = args;
  const header = `${payerName} owes ${payeeName} ${formatMoney(amount, currency)}`;
  if (!instruction.hasProfile || !instruction.hasContact) {
    return [
      header,
      `No settlement method saved for ${payeeName} yet.`,
    ].join("\n");
  }
  return [
    header,
    `Preferred payment: ${instruction.methodLabel}`,
    `Send to: ${instruction.destination}`,
    `Memo: ${instruction.memo}`,
  ].join("\n");
}

export function formatMoney(amount: number, currency: Currency): string {
  if (!Number.isFinite(amount)) return "—";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const body = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(2);
  return `${sign}$${body} ${currency}`;
}
