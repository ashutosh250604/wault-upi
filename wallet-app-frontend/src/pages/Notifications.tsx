import { useNavigate } from "react-router-dom";
import type { AppNotification, NotificationKind } from "../types";
import { cx } from "../lib/cx";
import { formatCurrency, formatTime } from "../lib/format";
import { amountTone, groupByDay, notificationTarget } from "../lib/notifications";
import { useNotifications } from "../hooks/useNotifications";
import { AppBar, AppShell } from "../components/AppShell";
import { NotificationBell } from "../components/NotificationBell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
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

/** The glyph and colour for each kind of news. */
function KindIcon({ kind }: { kind: NotificationKind }) {
  const tone: Record<NotificationKind, string> = {
    money_received: "bg-emerald-50 text-emerald-600",
    reward: "bg-amber-50 text-amber-600",
    topup: "bg-brand-50 text-brand-600",
    money_sent: "bg-slate-100 text-slate-500",
    request_received: "bg-rose-50 text-rose-500",
    request_declined: "bg-slate-100 text-slate-400",
    security: "bg-slate-100 text-slate-500",
  };

  const glyph = (() => {
    switch (kind) {
      case "money_received":
        return <IconReceived size={17} />;
      case "money_sent":
        return <IconSent size={17} />;
      case "topup":
        return <IconWallet size={17} />;
      case "reward":
        return <IconSpark size={17} />;
      case "request_received":
        return <IconNote size={17} />;
      case "request_declined":
        return <IconWarning size={17} />;
      case "security":
        return <IconLock size={17} />;
    }
  })();

  return (
    <span
      className={cx(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        tone[kind],
      )}
    >
      {glyph}
    </span>
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
    <div
      className={cx(
        "group flex items-start gap-3 rounded-2xl px-2 py-3 transition",
        notification.is_read ? "bg-transparent" : "bg-brand-50/40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none"
      >
        <KindIcon kind={notification.kind} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              className={cx(
                "min-w-0 flex-1 text-[13.5px] leading-snug",
                notification.is_read ? "font-medium text-slate-700" : "font-bold text-slate-900",
              )}
            >
              {notification.title}
            </span>
            {!notification.is_read ? (
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600"
                aria-label="Unread"
              />
            ) : null}
          </span>
          {notification.body ? (
            <span className="mt-0.5 block truncate text-[12px] text-slate-500">
              {notification.body}
            </span>
          ) : null}
          <span className="mt-1 block text-[11px] text-slate-400">
            {notification.created_at ? formatTime(notification.created_at) : ""}
            {notification.reference ? ` · ${notification.reference}` : ""}
          </span>
        </span>
        {notification.amount !== null ? (
          <span
            className={cx(
              "shrink-0 text-[13.5px] font-bold tabular-nums",
              tone === "credit"
                ? "text-emerald-600"
                : tone === "debit"
                  ? "text-slate-900"
                  : "text-slate-500",
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
        className="mt-1 shrink-0 rounded-full p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-rose-500 focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none"
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
                  className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={reload}
                disabled={status === "loading"}
                aria-label="Refresh notifications"
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
              >
                {status === "loading" ? <Spinner size={17} /> : <IconRefresh size={17} />}
              </button>
            </>
          }
        />
      }
    >
      <div className="space-y-4 px-5 pt-4 pb-6">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-brand-50 to-fuchsia-50/60 px-4 py-3 ring-1 ring-brand-100">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-brand-900">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                : "You're all caught up"}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-brand-900/70">
              Every payment, request and cashback writes a line here — and deleting a line
              never touches the money it describes.
            </p>
          </div>
          <NotificationBell unreadCount={unreadCount} />
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
              icon={<IconBell size={22} />}
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
                <h2 className="px-2 pb-1 text-[11.5px] font-bold tracking-[0.12em] text-slate-400 uppercase">
                  {day.label}
                </h2>
                <Card padded={false} className="divide-y divide-slate-100 px-2 py-1">
                  {day.items.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onOpen={open}
                      onDelete={(note) => remove(note.id)}
                    />
                  ))}
                </Card>
              </section>
            ))
          : null}
      </div>
    </AppShell>
  );
}
