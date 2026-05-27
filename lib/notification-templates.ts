/**
 * Settlement notification message generators.
 *
 * These are pure render functions: given a settlement context, they produce
 * the email / SMS text the host can copy into any messaging app. We never
 * call out to email or SMS providers from here.
 */

import { APP_NAME } from "./brand";
import { formatMoney, type PaymentInstruction } from "./payments";
import type { CurrencyBag } from "./ledger";
import type { Currency, RoundDetails } from "./types";

export type NotificationContext = {
  payerName: string;
  receiverName: string;
  amount: number;
  currency: Currency;
  details: RoundDetails;
  instruction: PaymentInstruction;
  /**
   * Cross-round unpaid total owed by the payer. The `owes` bag from
   * `getPlayerLedgerStats` is a perfect input; we sum it per currency here.
   */
  payerOutstanding: CurrencyBag;
};

export type EmailMessage = {
  subject: string;
  body: string;
};

export const EMAIL_SUBJECT = `${APP_NAME} - Round Settlement`;

export function buildEmailMessage(ctx: NotificationContext): EmailMessage {
  const lines: string[] = [];
  lines.push("Round:");
  lines.push(ctx.details.courseName);
  lines.push("Date:");
  lines.push(ctx.details.date);
  lines.push("");
  lines.push("Settlement:");
  lines.push("");
  lines.push(
    `${ctx.payerName} owes ${ctx.receiverName} ${formatMoney(ctx.amount, ctx.currency)}`,
  );
  lines.push("");
  lines.push("Preferred payment:");
  if (ctx.instruction.hasContact && ctx.instruction.destination) {
    lines.push(ctx.instruction.methodLabel);
    lines.push(ctx.instruction.destination);
  } else {
    lines.push(`No settlement method saved for ${ctx.receiverName} yet.`);
  }
  lines.push("");
  lines.push("Memo:");
  lines.push(ctx.instruction.memo);
  lines.push("");
  lines.push("Outstanding balance:");
  lines.push(formatOutstanding(ctx.payerOutstanding));
  lines.push("");
  lines.push("Please settle before the next round 😄");
  return { subject: EMAIL_SUBJECT, body: lines.join("\n") };
}

export function buildSmsMessage(ctx: NotificationContext): string {
  const lines: string[] = [];
  lines.push(APP_NAME);
  lines.push("");
  lines.push(ctx.details.courseName);
  lines.push("");
  lines.push(
    `${ctx.payerName} owes ${ctx.receiverName} ${formatMoney(ctx.amount, ctx.currency)}`,
  );
  lines.push("");
  lines.push("Preferred payment:");
  if (ctx.instruction.hasContact && ctx.instruction.destination) {
    lines.push(
      `${shortMethodLabel(ctx.instruction.methodLabel)} → ${ctx.instruction.destination}`,
    );
  } else {
    lines.push(`No method saved for ${ctx.receiverName}`);
  }
  lines.push("");
  lines.push("Outstanding balance:");
  lines.push(formatOutstanding(ctx.payerOutstanding));
  lines.push("");
  lines.push("Please settle before next round.");
  return lines.join("\n");
}

/** Plain-text email block suitable for clipboard copy (Subject + body). */
export function emailToText(email: EmailMessage): string {
  return `Subject: ${email.subject}\n\n${email.body}`;
}

/** Friendlier short form used inside SMS payment lines. */
function shortMethodLabel(label: string): string {
  if (label === "Interac e-Transfer") return "Interac";
  return label;
}

function formatOutstanding(bag: CurrencyBag): string {
  const parts: string[] = [];
  for (const c of ["CAD", "USD"] as Currency[]) {
    if (bag[c] > 0.005) parts.push(formatMoney(bag[c], c));
  }
  return parts.length ? parts.join(" + ") : "$0";
}
