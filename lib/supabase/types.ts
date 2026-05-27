/**
 * Supabase database type placeholder.
 *
 * Replace this file with generated types once the remote schema lands:
 *
 *   npx supabase gen types typescript \
 *     --project-id <ref> --schema public > lib/supabase/types.ts
 *
 * For now we sketch the tables we intend to migrate from localStorage so
 * callers can already use a typed `SupabaseClient<Database>` without
 * blocking on the real schema. Field shapes intentionally mirror the
 * existing in-memory models in `lib/types.ts` — when the real database
 * exists, regenerated types may differ slightly (snake_case, jsonb, etc.)
 * and any consumer code will be updated then.
 */

import type {
  BetType,
  Currency,
  LedgerStatus,
  NotificationStatus,
  NotificationType,
} from "../types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Placeholder shape. The real generated `Database` type will have
 * `Row` / `Insert` / `Update` triplets per table and snake_case columns.
 * We expose the same triplet shape here so consumer types compile, but
 * treat every column as the closest equivalent of its current
 * localStorage field.
 */
export type Database = {
  public: {
    Tables: {
      players: {
        Row: PlayerRow;
        Insert: PlayerInsert;
        Update: PlayerUpdate;
        Relationships: [];
      };
      rounds: {
        Row: RoundRow;
        Insert: RoundInsert;
        Update: RoundUpdate;
        Relationships: [];
      };
      round_players: {
        Row: RoundPlayerRow;
        Insert: RoundPlayerInsert;
        Update: RoundPlayerUpdate;
        Relationships: [];
      };
      bets: {
        Row: BetRow;
        Insert: BetInsert;
        Update: BetUpdate;
        Relationships: [];
      };
      hole_scores: {
        Row: HoleScoreRow;
        Insert: HoleScoreInsert;
        Update: HoleScoreUpdate;
        Relationships: [];
      };
      ledger_entries: {
        Row: LedgerEntryRow;
        Insert: LedgerEntryInsert;
        Update: LedgerEntryUpdate;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: NotificationInsert;
        Update: NotificationUpdate;
        Relationships: [];
      };
    };
    // Use the `[_ in never]: never` pattern (matching the official
    // `supabase gen types typescript` output) so `keyof Views` is `never`,
    // not `string` — otherwise `.from("players")` ambiguously matches the
    // view overload and `Insert` collapses to `never`.
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/* -------------------------------------------------------------------- */
/*  Tentative row shapes                                                  */
/* -------------------------------------------------------------------- */

/**
 * `players` row.
 *
 * Settlement info is denormalised into flat columns (rather than a single
 * `payment_profile` JSON blob) so we can query / index on individual
 * method fields and produce clean joins later. Column types are kept as
 * `string` so the placeholder works whether the real schema uses TEXT
 * columns or Postgres ENUMs — regenerated types will tighten them.
 */
export type PlayerRow = {
  /** Stable id (uuid in Supabase, slug-ish in localStorage today). */
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  /** Generated from email/phone/id, indexed for fast cross-round lookup. */
  normalized_contact_key: string;
  country: string | null;
  preferred_method: string | null;
  interac_email: string | null;
  interac_phone: string | null;
  venmo_handle: string | null;
  cash_app_tag: string | null;
  paypal_link: string | null;
  zelle_email: string | null;
  zelle_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
/**
 * Insert shape. NOT NULL columns are required; nullable columns are
 * optional and default to NULL via Postgres column defaults (matching
 * the conventions of `supabase gen types typescript` output).
 */
export type PlayerInsert = {
  id?: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  normalized_contact_key: string;
  country?: string | null;
  preferred_method?: string | null;
  interac_email?: string | null;
  interac_phone?: string | null;
  venmo_handle?: string | null;
  cash_app_tag?: string | null;
  paypal_link?: string | null;
  zelle_email?: string | null;
  zelle_phone?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};
export type PlayerUpdate = Partial<PlayerInsert>;

/** Minimal `rounds` row created on /create-round (scores/bets migrate later). */
export type RoundRow = {
  id: string;
  course_name: string;
  round_name: string | null;
  /** ISO `YYYY-MM-DD`. */
  round_date: string;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  created_at: string;
  updated_at: string;
};

export type RoundInsert = {
  id?: string;
  course_name: string;
  round_name?: string | null;
  round_date: string;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  created_at?: string;
  updated_at?: string;
};

export type RoundUpdate = Partial<RoundInsert>;

/** Join table linking a Supabase round to canonical players. */
export type RoundPlayerRow = {
  id: string;
  round_id: string;
  player_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

export type RoundPlayerInsert = {
  id?: string;
  round_id: string;
  player_id: string;
  display_name: string;
  created_at?: string;
  updated_at?: string;
};

export type RoundPlayerUpdate = Partial<RoundPlayerInsert>;

export type BetRow = {
  id: string;
  round_id: string;
  bet_type: BetType;
  config: Json;
  created_at: string;
  updated_at: string;
};

export type BetInsert = {
  id?: string;
  round_id: string;
  bet_type: BetType;
  config: Json;
  created_at?: string;
  updated_at?: string;
};

export type BetUpdate = Partial<BetInsert>;

export type HoleScoreRow = {
  id: string;
  round_id: string;
  player_id: string;
  hole_number: number;
  score: number;
  created_at: string;
  updated_at: string;
};

export type HoleScoreInsert = {
  id?: string;
  round_id: string;
  player_id: string;
  hole_number: number;
  score: number;
  created_at?: string;
  updated_at?: string;
};

export type HoleScoreUpdate = Partial<HoleScoreInsert>;

export type LedgerEntryRow = {
  id: string;
  round_id: string | null;
  round_name: string | null;
  course_name: string | null;
  /** ISO `YYYY-MM-DD` of the round. */
  round_date: string;
  payer_contact_key: string;
  payer_name: string;
  receiver_contact_key: string;
  receiver_name: string;
  amount: number;
  currency: Currency;
  status: LedgerStatus;
  payment_method: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};
export type LedgerEntryInsert = {
  id?: string;
  round_id?: string | null;
  round_name?: string | null;
  course_name?: string | null;
  round_date: string;
  payer_contact_key: string;
  payer_name: string;
  receiver_contact_key: string;
  receiver_name: string;
  amount: number;
  currency: Currency;
  status?: LedgerStatus;
  payment_method?: string | null;
  memo?: string | null;
  created_at?: string;
  updated_at?: string;
};
export type LedgerEntryUpdate = Partial<LedgerEntryInsert>;

export type NotificationRow = {
  id: string;
  /** Recipient (the payer / debtor). */
  player_contact_key: string;
  round_id: string | null;
  type: NotificationType;
  message: string;
  status: NotificationStatus;
  recipient_name: string | null;
  recipient_contact: string | null;
  round_name: string | null;
  course_name: string | null;
  date: string | null;
  amount: number | null;
  currency: Currency | null;
  receiver_contact_key: string | null;
  receiver_name: string | null;
  created_at: string;
  updated_at: string;
};
export type NotificationInsert = Omit<
  NotificationRow,
  "created_at" | "updated_at"
> & {
  created_at?: string;
  updated_at?: string;
};
export type NotificationUpdate = Partial<NotificationInsert>;
