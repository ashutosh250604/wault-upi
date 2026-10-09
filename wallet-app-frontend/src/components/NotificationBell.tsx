import { useNavigate } from "react-router-dom";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { badgeLabel } from "../lib/notifications";
import { IconBell } from "./ui/Icons";

/**
 * The inbox bell and its unread badge.
 *
 * Lives in the home hero (light-on-ink) and on the inbox header, hence the
 * `invert` flag rather than two components that could drift apart.
 */
export function NotificationBell({
  unreadCount,
  invert = false,
}: {
  unreadCount: number;
  invert?: boolean;
}) {
  const navigate = useNavigate();
  const label = badgeLabel(unreadCount);

  return (
    <button
      type="button"
      onClick={() => {
        feedback.tap();
        navigate("/notifications");
      }}
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : "Notifications, none unread"
      }
      className={cx(
        "relative rounded-[6px] p-2 transition focus-visible:ring-2 focus-visible:outline-none",
        invert
          ? "text-ink-200 hover:bg-ink-700 hover:text-ink-25 focus-visible:ring-ink-25"
          : "text-ink-600 hover:bg-paper-100 focus-visible:ring-ink-900/35",
      )}
    >
      <IconBell size={20} />
      {label ? (
        <span
          className={cx(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-seal-500 px-1 text-[9.5px] leading-none font-bold text-paper-25",
            invert && "ring-2 ring-ink-800",
          )}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}
