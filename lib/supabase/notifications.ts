/**
 * Remote (Supabase) reads/writes for `notifications`.
 *
 * TeeTabs never transmits email/SMS — we only persist the copyable
 * message + a small status ("draft" vs "sent") so hosts can track history.
 */

import type {
  Currency,
  Notification,
  NotificationStatus,
} from "../types";
import type { NotificationInput } from "../notifications";
import type { NotificationRow } from "./types";
import { parseSupabaseError, type SupabaseErrorDetails } from "./errors";

export type NotificationRemoteResult =
  | { ok: true; rows: NotificationRow[] }
  | { ok: false; reason: "unconfigured"; error: unknown }
  | { ok: false; reason: "error"; error: unknown; errorInfo: SupabaseErrorDetails };

export type SyncNotificationResult =
  | { ok: true; outcome: "cloud" }
  | { ok: false; outcome: "local"; errorInfo?: SupabaseErrorDetails; error: unknown };

export type SupabaseRoundIdOrNull = string | null | undefined;

function toNullableRoundName(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function toNullableString(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function toNullableNumber(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function toNullableCurrency(value: Currency | undefined): Currency | null {
  return value ? value : null;
}

function notificationRowToNotification(
  row: NotificationRow,
  ctx: {
    localRoundId: string;
    supabaseRoundId: string | undefined;
    details: { roundName?: string; courseName: string; date: string };
  },
): Notification {
  const isCurrentRound =
    ctx.supabaseRoundId
      ? row.round_id === ctx.supabaseRoundId
      : row.round_id === null &&
        (row.course_name ?? "") === (ctx.details.courseName ?? "") &&
        (row.date ?? "") === (ctx.details.date ?? "") &&
        (row.round_name ?? null) === toNullableRoundName(ctx.details.roundName);

  return {
    id: row.id,
    playerContactKey: row.player_contact_key,
    roundId: isCurrentRound ? ctx.localRoundId : `remote:${row.round_id ?? "null"}`,
    type: row.type,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipientName: row.recipient_name ?? undefined,
    recipientContact: row.recipient_contact ?? undefined,
    roundName: row.round_name ?? undefined,
    courseName: row.course_name ?? undefined,
    date: row.date ?? undefined,
    amount: row.amount ?? undefined,
    currency: row.currency ?? undefined,
    receiverContactKey: row.receiver_contact_key ?? undefined,
    receiverName: row.receiver_name ?? undefined,
  };
}

function notificationInputToPayload(
  input: NotificationInput & { status: NotificationStatus },
  options: { supabaseRoundId: SupabaseRoundIdOrNull },
): Record<string, unknown> {
  return {
    // `round_id` is nullable by design — when rounds weren't migrated (or
    // Supabase isn't configured) we store the notification without a FK.
    round_id: options.supabaseRoundId ?? null,
    player_contact_key: input.playerContactKey,
    type: input.type,
    message: input.message,
    status: input.status,
    recipient_name: input.recipientName ?? null,
    recipient_contact: input.recipientContact ?? null,
    round_name: toNullableRoundName(input.roundName),
    course_name: toNullableString(input.courseName),
    date: input.date ?? null,
    amount: toNullableNumber(input.amount),
    currency: toNullableCurrency(input.currency),
    receiver_contact_key: input.receiverContactKey ?? null,
    receiver_name: input.receiverName ?? null,
  };
}

/**
 * Fetch all notification rows. Never throws.
 */
export async function fetchNotificationsRemoteAll(
  ctx: {
    localRoundId: string;
    supabaseRoundId: string | undefined;
    details: { roundName?: string; courseName: string; date: string };
  },
): Promise<{ ok: true; notifications: Notification[] } | { ok: false; reason: "unconfigured" | "error"; error: unknown; errorInfo?: SupabaseErrorDetails }> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, reason: "unconfigured", error: err };
  }

  try {
    const { data, error } = await mod.supabase
      .from("notifications")
      .select("*");

    if (error) return { ok: false, reason: "error", error, errorInfo: parseSupabaseError(error) };

    const rows = (Array.isArray(data) ? data : []) as NotificationRow[];
    return {
      ok: true,
      notifications: rows.map((r) => notificationRowToNotification(r, ctx)),
    };
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    return { ok: false, reason: "error", error: err, errorInfo };
  }
}

/**
 * Upsert a draft notification keyed by:
 * (round_id, player_contact_key, type, status='draft').
 * Duplicate prevention is done by selecting the existing draft first.
 */
export async function upsertNotificationDraftRemote(
  input: NotificationInput & { status: "draft" },
  options: {
    supabaseRoundId: SupabaseRoundIdOrNull;
    localNotificationId?: string;
  },
): Promise<SyncNotificationResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, outcome: "local", error: err };
  }

  try {
    // If a `sent` row already exists for these keys, don't create/overwrite a
    // draft (this avoids races where the host marks sent before a late
    // "preview/copy" draft sync completes).
    try {
      const base = mod.supabase
        .from("notifications")
        .select("id")
        .eq("player_contact_key", input.playerContactKey)
        .eq("type", input.type)
        .eq("status", "sent");

      const { data: sentRow, error: sentSelectError } =
        await (options.supabaseRoundId
          ? base.eq("round_id", options.supabaseRoundId).maybeSingle()
          : input.courseName && input.date
            ? input.roundName
              ? base
                  .is("round_id", null)
                  .eq("course_name", input.courseName)
                  .eq("round_name", input.roundName)
                  .eq("date", input.date)
                  .maybeSingle()
              : base
                  .is("round_id", null)
                  .eq("course_name", input.courseName)
                  .is("round_name", null)
                  .eq("date", input.date)
                  .maybeSingle()
            : base.is("round_id", null).maybeSingle());

      if (sentRow && !sentSelectError) {
        const payload = notificationInputToPayload(
          { ...input, status: "sent" },
          { supabaseRoundId: options.supabaseRoundId },
        );
        const existingId = (sentRow as { id: string }).id;
        const { error: updateError } = await mod.supabase
          .from("notifications")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existingId);
        if (updateError) throw updateError;
        return { ok: true, outcome: "cloud" };
      }
    } catch {
      // Best-effort only: if sent-query fails, proceed with draft upsert.
    }

    const isRoundNull = !options.supabaseRoundId;
    const query = mod.supabase
      .from("notifications")
      .select("id")
      .eq("player_contact_key", input.playerContactKey)
      .eq("type", input.type)
      .eq("status", "draft")
      .eq("round_id", options.supabaseRoundId ?? null);

    const { data: existing, error: selectError } = await query.maybeSingle();
    if (selectError) {
      // Some Supabase builds are strict about `eq(null)`; fall back to a
      // nullable-safe selector.
      const fallbackQuery = mod.supabase
        .from("notifications")
        .select("id")
        .eq("player_contact_key", input.playerContactKey)
        .eq("type", input.type)
        .eq("status", "draft");

      const { data: existing2, error: selectError2 } =
        isRoundNull && input.courseName && input.date
          ? await fallbackQuery
              .is("round_id", null)
              .eq("course_name", input.courseName)
              .eq("date", input.date)
              .maybeSingle()
          : await fallbackQuery
              .eq("round_id", options.supabaseRoundId ?? null)
              .maybeSingle();

      if (selectError2) throw selectError2;
      if (existing2) {
        const existingId = (existing2 as { id: string }).id;
        const payload = notificationInputToPayload(input, {
          supabaseRoundId: options.supabaseRoundId,
        });
        const { error: updateError } = await mod.supabase
          .from("notifications")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existingId);
        if (updateError) throw updateError;
        return { ok: true, outcome: "cloud" };
      }
    } else if (existing) {
      const existingId = (existing as { id: string }).id;
      const payload = notificationInputToPayload(input, {
        supabaseRoundId: options.supabaseRoundId,
      });
      const { error: updateError } = await mod.supabase
        .from("notifications")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", existingId);
      if (updateError) throw updateError;
      return { ok: true, outcome: "cloud" };
    }

    const payload = notificationInputToPayload(input, {
      supabaseRoundId: options.supabaseRoundId,
    });

    const insertPayload =
      options.localNotificationId != null
        ? { ...payload, id: options.localNotificationId }
        : payload;

    const { error: insertError } = await mod.supabase
      .from("notifications")
      .insert(insertPayload);

    if (insertError) throw insertError;
    return { ok: true, outcome: "cloud" };
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    return { ok: false, outcome: "local", error: err, errorInfo };
  }
}

/**
 * Promote the matching draft to `sent` or insert a new sent row.
 */
export async function markNotificationSentRemote(
  input: NotificationInput,
  options: {
    supabaseRoundId: SupabaseRoundIdOrNull;
    localNotificationId?: string;
  },
): Promise<SyncNotificationResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, outcome: "local", error: err };
  }

  try {
    const isRoundNull = !options.supabaseRoundId;

    const draftQuery = mod.supabase
      .from("notifications")
      .select("id")
      .eq("player_contact_key", input.playerContactKey)
      .eq("type", input.type)
      .eq("status", "draft")
      .eq("round_id", options.supabaseRoundId ?? null);

    const { data: draftRow, error: draftError } = await draftQuery.maybeSingle();
    if (draftError) {
      // Nullable safe retry when round_id is null
      const fallback = mod.supabase
        .from("notifications")
        .select("id")
        .eq("player_contact_key", input.playerContactKey)
        .eq("type", input.type)
        .eq("status", "draft");

      const { data: draftRow2, error: draftError2 } =
        isRoundNull && input.courseName && input.date
          ? await fallback
              .is("round_id", null)
              .eq("course_name", input.courseName)
              .eq("date", input.date)
              .maybeSingle()
          : await fallback
              .eq("round_id", options.supabaseRoundId ?? null)
              .maybeSingle();

      if (draftError2) throw draftError2;
      if (draftRow2) {
        const payload = notificationInputToPayload(
          { ...input, status: "sent" },
          { supabaseRoundId: options.supabaseRoundId },
        );
        const existingId = (draftRow2 as { id: string }).id;
        const { error: updateError } = await mod.supabase
          .from("notifications")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existingId);
        if (updateError) throw updateError;
        return { ok: true, outcome: "cloud" };
      }
    } else if (draftRow) {
      const existingId = (draftRow as { id: string }).id;
      const payload = notificationInputToPayload(
        { ...input, status: "sent" },
        { supabaseRoundId: options.supabaseRoundId },
      );
      const { error: updateError } = await mod.supabase
        .from("notifications")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", existingId);
      if (updateError) throw updateError;
      return { ok: true, outcome: "cloud" };
    }

    const payload = notificationInputToPayload(
      { ...input, status: "sent" },
      { supabaseRoundId: options.supabaseRoundId },
    );
    const insertPayload =
      options.localNotificationId != null
        ? { ...payload, id: options.localNotificationId }
        : payload;

    const { error: insertError } = await mod.supabase
      .from("notifications")
      .insert(insertPayload);
    if (insertError) throw insertError;
    return { ok: true, outcome: "cloud" };
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    return { ok: false, outcome: "local", error: err, errorInfo };
  }
}

/**
 * Update a notification status by its row id.
 * (Used by the Notification History panel.)
 */
export async function updateNotificationStatusRemoteById(
  id: string,
  status: NotificationStatus,
): Promise<SyncNotificationResult> {
  let mod: typeof import("./client");
  try {
    mod = await import("./client");
  } catch (err) {
    return { ok: false, outcome: "local", error: err };
  }

  try {
    const { error } = await mod.supabase
      .from("notifications")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return { ok: true, outcome: "cloud" };
  } catch (err) {
    const errorInfo = parseSupabaseError(err);
    return { ok: false, outcome: "local", error: err, errorInfo };
  }
}

