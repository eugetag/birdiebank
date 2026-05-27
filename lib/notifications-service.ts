/**
 * Cross-round notification sync service.
 *
 * UI keeps using localStorage as its source of truth, but we mirror
 * notifications to Supabase when it is configured.
 */

import type {
  Notification,
  NotificationStatus,
} from "./types";
import type { NotificationInput } from "./notifications";
import {
  getNotifications,
  markNotificationSent,
  upsertNotification,
  updateNotificationStatus,
} from "./notifications";
import {
  fetchNotificationsRemoteAll,
  markNotificationSentRemote,
  updateNotificationStatusRemoteById,
  upsertNotificationDraftRemote,
} from "./supabase/notifications";
import type { RoundSyncState } from "./types";
import { NOTIFICATIONS_KEY } from "./notifications";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function safeWriteNotifications(entries: Notification[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(entries));
}

function mergeById(a: Notification[], b: Notification[]): Notification[] {
  const m = new Map<string, Notification>();
  for (const n of a) m.set(n.id, n);
  for (const n of b) m.set(n.id, n);
  return [...m.values()];
}

export type NotificationsSyncOutcome = RoundSyncState;

export async function loadNotificationHistoryForResults(opts: {
  localRoundId: string;
  supabaseRoundId: string | undefined;
  details: { roundName?: string; courseName: string; date: string };
}): Promise<{ notifications: Notification[]; outcome: NotificationsSyncOutcome }> {
  const local = getNotifications();
  try {
    const remote = await fetchNotificationsRemoteAll({
      localRoundId: opts.localRoundId,
      supabaseRoundId: opts.supabaseRoundId,
      details: opts.details,
    });

    if (!remote.ok) {
      return { notifications: local, outcome: "local" };
    }

    const merged = mergeById(local, remote.notifications);
    safeWriteNotifications(merged);
    return { notifications: merged, outcome: "cloud" };
  } catch {
    // Any failure: show local history immediately.
    return { notifications: local, outcome: "local" };
  }
}

export function syncUpsertNotificationDraft(params: {
  input: NotificationInput & { status: "draft" };
  supabaseRoundId: string | undefined;
}): { notification: Notification; remoteSync: Promise<NotificationsSyncOutcome> } {
  const notification = upsertNotification(params.input);

  const remoteSync = (async (): Promise<NotificationsSyncOutcome> => {
    try {
      const result = await upsertNotificationDraftRemote(params.input, {
        supabaseRoundId: params.supabaseRoundId,
        localNotificationId: notification.id,
      });
      return result.ok ? "cloud" : "local";
    } catch {
      return "local";
    }
  })();

  return { notification, remoteSync };
}

export function syncMarkNotificationSent(params: {
  input: NotificationInput;
  supabaseRoundId: string | undefined;
}): { notification: Notification; remoteSync: Promise<NotificationsSyncOutcome> } {
  const notification = markNotificationSent(params.input);

  const remoteSync = (async (): Promise<NotificationsSyncOutcome> => {
    try {
      const result = await markNotificationSentRemote(params.input, {
        supabaseRoundId: params.supabaseRoundId,
        localNotificationId: notification.id,
      });
      return result.ok ? "cloud" : "local";
    } catch {
      return "local";
    }
  })();

  return { notification, remoteSync };
}

export function syncUpdateNotificationStatus(params: {
  id: string;
  status: NotificationStatus;
  supabaseRoundId: string | undefined;
}): { notification: Notification | undefined; remoteSync: Promise<NotificationsSyncOutcome> | null } {
  const localNotification = updateNotificationStatus(params.id, params.status);

  if (!isBrowser()) {
    return { notification: localNotification, remoteSync: null };
  }

  const remoteSync =
    params.supabaseRoundId === undefined
      ? (async (): Promise<NotificationsSyncOutcome> => "local")()
      : (async (): Promise<NotificationsSyncOutcome> => {
          const res = await updateNotificationStatusRemoteById(
            params.id,
            params.status,
          );
          return res.ok ? "cloud" : "local";
        })();

  return { notification: localNotification, remoteSync };
}

