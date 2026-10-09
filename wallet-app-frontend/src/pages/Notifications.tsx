import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { AppNotification, NotificationKind } from "../types";
import { cx } from "../lib/cx";
import { formatCurrency, formatTime } from "../lib/format";
import { amountTone, groupByDay, notificationTarget } from "../lib/notifications";
import { useNotifications } from "../hooks/useNotifications";
import { AppBar, AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Coin } from "../components/ui/Coin";
import { TILE_GLYPH, TILE_STROKE, type IconTone } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import {
  IconBell,
  IconLock,
  IconNote,
  IconReceived,
  IconRefresh,
  IconSent,
  IconSpark,
  IconTrash,
  IconWallet,
  IconWarning,
} from "../components/ui/Icons";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState, ErrorState, TransactionSkeleton } from "../components/ui/States";

/**
 * The glyph and the tone for each kind of news.
 *
 * Only those two things vary. Every row wears the same tile — same box, same
 * radius, same ring — so the colours read as a legend rather than as seven
 * different treatments: green is money in, amber is something the wallet gave
 * you, red is somebody asking, grey is a closed door.
 *
 * The reward row shows the coin artwork rather than a star. A coin reward with a
 * star on it was the one place the app stopped calling a coin a coin.
 */
const NEWS: Record<
  NotificationKind,
  { tone: IconTone; Glyph: (props: { size?: number; strokeWidth?: number }) => ReactNode }
> = {
  money_received: { tone: "credit", Glyph: IconReceived },
  money_sent: { tone: "ink", Glyph: IconSent },
  topup: { tone: "ink", Glyph: IconWallet },
  reward: {
    tone: "pending",
    // A picture, not a line drawing: the coin sits a touch larger than a glyph
    // to fill the same box.
    Glyph: ({ size }) => <Coin size={(size ?? TILE_GLYPH.sm) + 3} />,
  },
  scratch_card: { tone: "pending", Glyph: IconSpark },
  request_received: { tone: "seal", Glyph: IconNote },
  request_declined: { tone: "muted", Glyph: IconWarning },
  security: { tone: "pending", Glyph: IconLock },
};

/** One row's icon, in the app's one icon treatment. */
function KindIcon({ kind }: { kind: NotificationKind }) {
  const { tone, Glyph } = NEWS[kind];
  return (
    <IconTile tone={tone} scale="sm">
      <Glyph size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />
    </IconTile>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onDelete,
}: {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onDelete: (notification: AppNotification) => void;
}) {
  const tone = amountTone(notification.kind);

  return (
    <div className="group flex items-start gap-2 px-1 py-3.5 transition hover:bg-paper-100">
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
      >
        <KindIcon kind={notification.kind} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              className={cx(
                "min-w-0 flex-1 text-[13.5px] leading-snug",
                notification.is_read ? "font-medium text-ink-600" : "font-bold text-ink-900",
              )}
            >
              {notification.title}
            </span>
            {!notification.is_read ? (
              <span
                className="mt-1.5 size-2 shrink-0 rounded-[2px] bg-seal-500"
                aria-label="Unread"
              />
            ) : null}
          </span>
          {notification.body ? (
            <span className="mt-0.5 block truncate text-[12px] text-ink-500">
              {notification.body}
            </span>
          ) : null}
          <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-400">
            <span>{notification.created_at ? formatTime(notification.created_at) : ""}</span>
            {notification.reference ? (
              <>
                <span aria-hidden="true" className="h-2.5 w-px bg-ink-200" />
                <span className="truncate font-mono">{notification.reference}</span>
              </>
            ) : null}
          </span>
        </span>
        {notification.amount !== null ? (
          <span
            className={cx(
              "shrink-0 text-[13.5px] font-bold tabular-nums",
              tone === "credit"
                ? "text-credit-600"
                : tone === "debit"
                  ? "text-ink-900"
                  : "text-ink-500",
            )}
          >
            {tone === "debit" ? "−" : tone === "credit" ? "+" : ""}
            {formatCurrency(notification.amount)}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={() => onDelete(notification)}
        aria-label={`Delete notification: ${notification.title}`}
        className="mt-0.5 shrink-0 rounded-[6px] p-1.5 text-ink-300 transition hover:bg-paper-200 hover:text-seal-600 focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
      >
        <IconTrash size={15} />
      </button>
    </div>
  );
}

/**
 * The inbox. Opening a row marks it read and takes the reader to the screen that
 * owns the detail — the notification itself is only ever a pointer at something
 * that already happened elsewhere in the app.
 */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    status,
    error,
    reload,
    markRead,
    markAllRead,
    remove,
  } = useNotifications();

  const open = (notification: AppNotification) => {
    if (!notification.is_read) markRead(notification.id);
    navigate(notificationTarget(notification.kind));
  };

  return (
    <AppShell
      nav
      onRefresh={reload}
      header={
        <AppBar
          title="Notifications"
          showBack
          right={
            <>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="rounded-[6px] px-2 py-1 text-[12.5px] font-semibold text-seal-700 transition hover:bg-seal-50"
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={reload}
                disabled={status === "loading"}
                aria-label="Refresh notifications"
                className="rounded-[6px] p-2 text-ink-500 transition hover:bg-paper-200 hover:text-ink-700 disabled:opacity-60"
              >
                {status === "loading" ? <Spinner size={17} /> : <IconRefresh size={17} />}
              </button>
            </>
          }
        />
      }
    >
      <div className="space-y-4 px-5 pt-4 pb-6">
        <div className="flex items-center justify-between gap-3 rounded-[10px] bg-ink-900 px-4 py-3.5 text-ink-25">
          <div className="min-w-0">
            <p className="font-display text-[14.5px] font-bold tracking-tight">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                : "You're all caught up"}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-300">
              Deleting a notification never touches the money it describes.
            </p>
          </div>
          <IconBell size={20} className="shrink-0 text-ink-400" />
        </div>

        {status === "error" && notifications === null ? (
          <Card>
            <ErrorState message={error ?? "We couldn't load your notifications."} onRetry={reload} />
          </Card>
        ) : null}

        {status === "loading" && notifications === null ? (
          <Card>
            <TransactionSkeleton rows={5} />
          </Card>
        ) : null}

        {notifications !== null && notifications.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconBell size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />}
              title="Nothing here yet"
              description="Pay someone, top up your wallet or ask to be paid, and a note about it will land here."
              action={
                <Button onClick={() => navigate("/home")} variant="secondary">
                  Back to wallet
                </Button>
              }
            />
          </Card>
        ) : null}

        {notifications !== null && notifications.length > 0
          ? groupByDay(notifications).map((day) => (
              <section key={day.key}>
                <h2 className="border-b border-ink-200 pb-1.5 text-[12.5px] font-semibold text-ink-500">
                  {day.label}
                </h2>
                <div className="divide-y divide-ink-200/70">
                  {day.items.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onOpen={open}
                      onDelete={(note) => remove(note.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          : null}
      </div>
    </AppShell>
  );
}
