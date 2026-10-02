/**
 * Display helpers for the inbox — pure, so the screens stay thin.
 *
 * The API deliberately says *what* happened and nothing about where to go; the
 * one place that maps an event kind onto a route is here, so a change to the
 * route table can't leave a dead tap target behind in two different components.
 */

import type { AppNotification, NotificationKind } from "../types";
import { dayKey, formatDayLabel } from "./format";

export type InboxStatus = "loading" | "ready" | "error";

/** Where tapping a notification takes the reader. */
export function notificationTarget(kind: NotificationKind): string {
  switch (kind) {
    case "money_received":
    case "money_sent":
    case "topup":
      return "/history";
    case "request_received":
    case "request_declined":
      return "/requests";
    case "reward":
      // The offers strip, and the balance the cashback landed in.
      return "/home";
    case "security":
      return "/profile";
  }
}

/** "2 unread" / "9+" — badge copy, capped so a long count can't widen the bell. */
export function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

export interface NotificationDay {
  key: string;
  label: string;
  items: AppNotification[];
}

/** Newest first (as the API returns them), grouped into day buckets. */
export function groupByDay(notifications: AppNotification[]): NotificationDay[] {
  const days = new Map<string, NotificationDay>();

  for (const note of notifications) {
    const iso = note.created_at ?? new Date().toISOString();
    const key = dayKey(iso);
    let day = days.get(key);
    if (!day) {
      day = { key, label: formatDayLabel(iso), items: [] };
      days.set(key, day);
    }
    day.items.push(note);
  }

  return [...days.values()];
}

/**
 * How a row's amount should read: money that arrived, money that left, or an
 * amount that is still only being asked for and hasn't moved anywhere.
 */
export function amountTone(kind: NotificationKind): "credit" | "debit" | "neutral" {
  if (kind === "money_received" || kind === "topup" || kind === "reward") return "credit";
  if (kind === "money_sent") return "debit";
  return "neutral";
}
