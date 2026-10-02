import { useCallback, useEffect, useState } from "react";
import type { AppNotification } from "../types";
import { api, errorMessage } from "../lib/api";
import type { InboxStatus } from "../lib/notifications";

/**
 * Owns the inbox and its unread badge.
 *
 * `reloadKey` lets a parent pull in new rows when something that mints one has
 * happened — the newest transaction's id is the right key, because every
 * notification the money paths write is about a ledger row.
 */
export function useNotifications(reloadKey?: unknown, limit = 50) {
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<InboxStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const payload = await api.notifications(limit, signal);
        setNotifications(payload.notifications);
        setUnreadCount(payload.unread_count);
        setStatus("ready");
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setError(errorMessage(err));
      }
    },
    [limit],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  return {
    notifications,
    unreadCount,
    status,
    error,
    reload: () => void load(),
    /** Optimistic: reading a row is reversible and the count is the only state. */
    markRead: (id: number) => {
      setNotifications((current) =>
        (current ?? []).map((note) =>
          note.id === id ? { ...note, is_read: true } : note,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      void api
        .markNotificationRead(id)
        .then((payload) => setUnreadCount(payload.unread_count))
        .catch(() => void load());
    },
    markAllRead: () => {
      setNotifications((current) =>
        (current ?? []).map((note) => ({ ...note, is_read: true })),
      );
      setUnreadCount(0);
      void api
        .markAllNotificationsRead()
        .then((payload) => setUnreadCount(payload.unread_count))
        .catch(() => void load());
    },
    remove: (id: number) => {
      const wasUnread = (notifications ?? []).some(
        (note) => note.id === id && !note.is_read,
      );
      setNotifications((current) => (current ?? []).filter((note) => note.id !== id));
      if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
      void api
        .deleteNotification(id)
        .then((payload) => setUnreadCount(payload.unread_count))
        .catch(() => void load());
    },
  };
}
