/**
 * Remote list fetch for `players` (directory picker on /players).
 */

import type { DirectoryEntry, Country, PaymentMethod } from "../types";
import type { PlayerRow } from "./types";

export type PlayersListRemoteResult =
  | { ok: true; players: DirectoryEntry[] }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown };

function asCountry(value: string | null): Country | undefined {
  if (value === "Canada" || value === "United States" || value === "Other") {
    return value;
  }
  return undefined;
}

function asPaymentMethod(value: string | null): PaymentMethod | undefined {
  const methods: PaymentMethod[] = [
    "Interac e-Transfer",
    "Venmo",
    "Cash App",
    "PayPal",
    "Zelle",
    "Cash",
    "Other",
  ];
  if (value && methods.includes(value as PaymentMethod)) {
    return value as PaymentMethod;
  }
  return undefined;
}

export function rowToDirectoryEntry(row: PlayerRow): DirectoryEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    normalizedContactKey: row.normalized_contact_key,
    country: asCountry(row.country),
    preferredMethod: asPaymentMethod(row.preferred_method),
    interacEmail: row.interac_email ?? undefined,
    interacPhone: row.interac_phone ?? undefined,
    venmoHandle: row.venmo_handle ?? undefined,
    cashAppTag: row.cash_app_tag ?? undefined,
    paypalLink: row.paypal_link ?? undefined,
    zelleEmail: row.zelle_email ?? undefined,
    zellePhone: row.zelle_phone ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fetch all players for the directory picker. Never throws. */
export async function fetchPlayersListRemote(): Promise<PlayersListRemoteResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const { data, error } = await mod.supabase
      .from("players")
      .select(
        "id, display_name, email, phone, normalized_contact_key, country, preferred_method, interac_email, interac_phone, venmo_handle, cash_app_tag, paypal_link, zelle_email, zelle_phone, notes, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) return { ok: false, reason: "error", error };

    const rows = (Array.isArray(data) ? data : []) as PlayerRow[];
    return {
      ok: true,
      players: rows.map(rowToDirectoryEntry),
    };
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }
}
