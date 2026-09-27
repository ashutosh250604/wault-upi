import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { cx } from "../lib/cx";
import {
  IconArrowLeft,
  IconHome,
  IconQr,
  IconReceipt,
  IconScan,
  IconUser,
} from "./ui/Icons";

/**
 * Fixed-height app frame: header and nav never scroll, only the middle does.
 * On desktop the whole thing reads as a phone-shaped surface on the mesh
 * background instead of stretching edge to edge.
 */
export interface AppShellProps {
  header?: ReactNode;
  nav?: boolean;
  /** Pinned above the nav — used by screens with a keypad. */
  footer?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function AppShell({
  header,
  nav = false,
  footer,
  children,
  contentClassName,
}: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col items-center sm:p-4">
      <div className="flex h-full w-full max-w-[27rem] flex-col overflow-hidden bg-white shadow-xl shadow-slate-900/5 sm:rounded-[1.75rem] sm:ring-1 sm:ring-slate-900/5">
        {header}
        <main
          className={cx(
            "app-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain",
            contentClassName,
          )}
        >
          {children}
        </main>
        {footer}
        {nav ? <BottomNav /> : null}
      </div>
    </div>
  );
}

export interface AppBarProps {
  title?: string;
  /** Rendered to the right of the title. */
  right?: ReactNode;
  /** Overrides the title area entirely (used by the home wordmark). */
  children?: ReactNode;
  showBack?: boolean;
  border?: boolean;
}

export function AppBar({ title, right, children, showBack = false, border = true }: AppBarProps) {
  const navigate = useNavigate();

  return (
    <header
      className={cx(
        "z-10 flex h-14 shrink-0 items-center gap-1 bg-white/90 px-2 backdrop-blur",
        border && "border-b border-slate-100",
      )}
    >
      {showBack ? (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="-ml-0.5 rounded-full p-2 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <IconArrowLeft size={20} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 px-2">
        {children ?? (
          <h1 className="truncate text-[16.5px] font-bold tracking-tight text-slate-900">
            {title}
          </h1>
        )}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-1 pr-1">{right}</div> : null}
    </header>
  );
}

/** The wordmark, with a permanent reminder that this is a demo. */
export function BrandMark() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-fuchsia-500 text-[13px] font-black text-white">
        P
      </span>
      <span className="text-[16px] font-bold tracking-tight text-slate-900">PocketPay</span>
      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-700 uppercase">
        Demo
      </span>
    </span>
  );
}

const NAV_ITEMS = [
  { to: "/home", label: "Home", Icon: IconHome },
  { to: "/history", label: "History", Icon: IconReceipt },
] as const;

const NAV_ITEMS_RIGHT = [
  { to: "/my-qr", label: "My QR", Icon: IconQr },
  { to: "/profile", label: "Profile", Icon: IconUser },
] as const;

function NavItem({
  to,
  label,
  Icon,
}: {
  to: string;
  label: string;
  Icon: (props: { size?: number }) => ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          "flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-semibold transition",
          isActive ? "text-brand-700" : "text-slate-400 hover:text-slate-600",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cx(
              "flex h-7 w-11 items-center justify-center rounded-full transition",
              isActive && "bg-brand-50",
            )}
          >
            <Icon size={19} />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="shrink-0 border-t border-slate-100 bg-white/95 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      <div className="flex items-stretch px-2 pt-1.5">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <NavLink
          to="/scan"
          aria-label="Scan a QR code to pay"
          className="flex flex-1 flex-col items-center justify-end gap-0.5 text-[10.5px] font-semibold"
        >
          {({ isActive }) => (
            <>
              <span
                className={cx(
                  "-mt-5 flex size-12 items-center justify-center rounded-full text-white shadow-lg transition",
                  isActive
                    ? "bg-gradient-to-br from-brand-500 to-fuchsia-500 shadow-brand-600/30"
                    : "bg-brand-600 shadow-brand-600/30 hover:bg-brand-700",
                )}
              >
                <IconScan size={22} />
              </span>
              <span className={isActive ? "text-brand-700" : "text-slate-400"}>Scan</span>
            </>
          )}
        </NavLink>

        {NAV_ITEMS_RIGHT.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
