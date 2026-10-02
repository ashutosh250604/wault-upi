import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PaySheet } from "./PaySheet";
import { PullIndicator } from "./ui/PullIndicator";
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
  /** Enables the touch pull-to-refresh gesture on the scroll area. */
  onRefresh?: () => Promise<void> | void;
  /** Dark, edge-to-edge surface for the camera. */
  bare?: boolean;
  /**
   * Puts the header inside the scroll area so screens can overlap content onto
   * it (the home hero + quick actions). A fixed header would clip that overlap,
   * because the scroll container only paints from its own top edge down.
   */
  scrollHeader?: boolean;
}

export function AppShell({
  header,
  nav = false,
  footer,
  children,
  contentClassName,
  onRefresh,
  bare = false,
  scrollHeader = false,
}: AppShellProps) {
  const pull = usePullToRefresh(onRefresh ?? (() => {}), Boolean(onRefresh));
  // Owned here so the centre "Pay" action works from any tab.
  const [payOpen, setPayOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col items-center sm:p-4">
      <div
        className={cx(
          "flex h-full w-full max-w-[27rem] flex-col overflow-hidden shadow-xl shadow-slate-900/10 sm:rounded-[1.75rem] sm:ring-1 sm:ring-slate-900/10",
          bare ? "bg-slate-950" : "bg-white",
        )}
      >
        {!scrollHeader ? header : null}
        {onRefresh ? (
          <PullIndicator
            distance={pull.distance}
            progress={pull.progress}
            refreshing={pull.refreshing}
          />
        ) : null}
        <main
          ref={onRefresh ? pull.ref : undefined}
          // Every page animates in on mount, which is what makes navigation
          // feel like a screen push rather than a document swap.
          className={cx(
            "app-scroll min-h-0 flex-1 animate-enter overflow-y-auto overscroll-contain",
            contentClassName,
          )}
        >
          {scrollHeader ? header : null}
          {children}
        </main>
        {footer}
        {nav ? <BottomNav onPay={() => setPayOpen(true)} /> : null}
      </div>

      <PaySheet open={payOpen} onClose={() => setPayOpen(false)} />
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

/** The wordmark. */
export function BrandMark({ invert = false }: { invert?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={cx(
          "flex size-7 items-center justify-center rounded-lg text-[13px] font-black",
          invert ? "bg-white/20 text-white" : "bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white",
        )}
        aria-hidden="true"
      >
        W
      </span>
      <span
        className={cx(
          "text-[16px] font-bold tracking-tight",
          invert ? "text-white" : "text-slate-900",
        )}
      >
        Wallet Pay
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

export function BottomNav({ onPay }: { onPay?: () => void }) {
  return (
    <nav
      aria-label="Primary"
      className="shrink-0 border-t border-slate-100 bg-white/95 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      <div className="flex items-stretch px-2 pt-1.5">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <button
          type="button"
          onClick={() => {
            feedback.tap();
            onPay?.();
          }}
          aria-label="Pay or scan"
          className="flex flex-1 flex-col items-center justify-end gap-0.5 text-[10.5px] font-semibold"
        >
          <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-lg shadow-brand-600/30 transition active:scale-95">
            <IconScan size={22} />
          </span>
          <span className="text-slate-400">Pay</span>
        </button>

        {NAV_ITEMS_RIGHT.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
