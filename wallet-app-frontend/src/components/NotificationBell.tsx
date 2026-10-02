import { useNavigate } from "react-router-dom";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { badgeLabel } from "../lib/notifications";
import { IconBell } from "./ui/Icons";

/**
 * The inbox bell and its unread badge.
 *
 * Lives in the home hero (light-on-dark) and on the inbox header, hence the
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
        "relative rounded-full p-2 transition focus-visible:outline-none focus-visible:ring-2",
        invert
          ? "text-white/90 hover:bg-white/15 hover:text-white focus-visible:ring-white"
          : "text-slate-600 hover:bg-slate-100 focus-visible:ring-brand-500/50",
      )}
    >
      <IconBell size={20} />
      {label ? (
        <span
          className={cx(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9.5px] leading-none font-bold text-white",
            invert && "ring-2 ring-brand-600",
          )}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}
