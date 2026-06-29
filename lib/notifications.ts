/**
 * Settlement notification log.
 *
 * Persists at `gbl_notifications` as a flat array. Each entry represents one
 * email or SMS message that the host has previewed (draft) or marked as sent.
 *
 * TeeTabs never actually transmits these messages — we only generate
 * the copy-pasteable text and remember what the host has produced so the
 * history view can show "you've sent 3 of 5 settlement messages this round."
 *
 * Schema is intentionally Supabase-friendly: flat row, stable id, ISO
 * timestamps, no embedded references beyond stable contact keys / round ids.
 */

import type {
  Currency,
  Notification,
  NotificationStatus,
  NotificationType,
} from "./types";

export const NOTIFICATIONS_KEY = "gbl_notifications";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(): string {
  if (isBrowser() && "crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `n_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function getNotifications(): Notification[] {
  if (!isBrowser()) return [];
  const parsed = safeParse<Notification[]>(
    window.localStorage.getItem(NOTIFICATIONS_KEY),
  );
  return Array.isArray(parsed) ? parsed : [];
}

function writeNotifications(entries: Notification[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(entries));
}

/** Input accepted by both upsertNotification and markNotificationSent. */
export type NotificationInput = {
  playerContactKey: string;
  roundId: string;
  type: NotificationType;
  message: string;
  recipientName?: string;
  recipientContact?: string;
  roundName?: string;
  courseName?: string;
  date?: string;
  amount?: number;
  currency?: Currency;
  receiverContactKey?: string;
  receiverName?: string;
};

/**
 * Upsert a `draft` notification keyed by `(roundId, playerContactKey, type)`.
 * Re-previewing the same row updates the existing draft (refreshed message
 * + updatedAt) rather than spawning duplicates. `sent` rows are immutable —
 * if there's no draft we always create a new entry.
 */
export function upsertNotification(
  input: NotificationInput & { status: NotificationStatus },
): Notification {
  const entries = getNotifications();
  if (input.status === "draft") {
    const idx = entries.findIndex(
      (e) =>
        e.roundId === input.roundId &&
        e.playerContactKey === input.playerContactKey &&
        e.type === input.type &&
        e.status === "draft",
    );
    if (idx !== -1) {
      const updated: Notification = {
        ...entries[idx],
        ...input,
        updatedAt: nowIso(),
      };
      entries[idx] = updated;
      writeNotifications(entries);
      return updated;
    }
  }
  const now = nowIso();
  const created: Notification = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  entries.push(created);
  writeNotifications(entries);
  return created;
}

/**
 * Promote the matching `draft` to `sent`, or create a new `sent` row if
 * the host never previewed first. The message text is overwritten on the
 * promotion so the saved record always matches what the host most likely
 * actually sent.
 */
export function markNotificationSent(input: NotificationInput): Notification {
  const entries = getNotifications();
  const idx = entries.findIndex(
    (e) =>
      e.roundId === input.roundId &&
      e.playerContactKey === input.playerContactKey &&
      e.type === input.type &&
      e.status === "draft",
  );
  if (idx !== -1) {
    const updated: Notification = {
      ...entries[idx],
      ...input,
      status: "sent",
      updatedAt: nowIso(),
    };
    entries[idx] = updated;
    writeNotifications(entries);
    return updated;
  }
  return upsertNotification({ ...input, status: "sent" });
}

export function updateNotificationStatus(
  id: string,
  status: NotificationStatus,
): Notification | undefined {
  const entries = getNotifications();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return undefined;
  const updated: Notification = {
    ...entries[idx],
    status,
    updatedAt: nowIso(),
  };
  entries[idx] = updated;
  writeNotifications(entries);
  return updated;
}

export type NotificationQuery = {
  roundId?: string;
  playerContactKey?: string;
  type?: NotificationType;
  status?: NotificationStatus;
};

export function findNotifications(query: NotificationQuery = {}): Notification[] {
  return getNotifications().filter((e) => {
    if (query.roundId && e.roundId !== query.roundId) return false;
    if (
      query.playerContactKey &&
      e.playerContactKey !== query.playerContactKey
    )
      return false;
    if (query.type && e.type !== query.type) return false;
    if (query.status && e.status !== query.status) return false;
    return true;
  });
}
