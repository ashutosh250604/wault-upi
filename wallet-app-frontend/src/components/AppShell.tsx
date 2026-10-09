import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { BRAND, BRAND_ASSETS, markHeight } from "../lib/brand";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PaySheet } from "./PaySheet";
import { PullIndicator } from "./ui/PullIndicator";
import {
  IconArrowLeft,
  IconHome,
  IconPlus,
  IconQr,
  IconReceipt,
  IconUser,
} from "./ui/Icons";

/**
 * Fixed-height app frame: header and nav never scroll, only the middle does.
 * On desktop the whole thing reads as a proof sheet around a phone-shaped
 * surface instead of stretching edge to edge.
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
    <div className="flex h-dvh flex-col items-center sm:p-5">
      <div
        className={cx(
          "flex h-full w-full max-w-[26rem] flex-col overflow-hidden",
          "sm:rounded-[18px] sm:border sm:border-ink-900/10 sm:shadow-[0_24px_60px_-34px_rgba(15,15,13,0.5)]",
          bare ? "bg-ink-950" : "bg-paper-50",
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
        "z-10 flex h-14 shrink-0 items-center gap-1 bg-paper-50/95 px-2 backdrop-blur",
        border && "border-b border-ink-200",
      )}
    >
      {showBack ? (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="-ml-0.5 rounded-[6px] p-2 text-ink-700 transition hover:bg-paper-100 focus-visible:ring-2 focus-visible:ring-ink-900/35 focus-visible:outline-none"
        >
          <IconArrowLeft size={20} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1 px-2">
        {children ?? (
          <h1 className="truncate font-display text-[17px] font-bold tracking-tight text-ink-900">
            {title}
          </h1>
        )}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-1 pr-1">{right}</div> : null}
    </header>
  );
}

/**
 * The app-icon tile: a red rounded square carrying the mark.
 *
 * This is the artwork `public/brand/wault-icon.png` — the supplied tile with the
 * cream bed it was exported on cropped away, so it drops onto the dark header as
 * cleanly as onto paper. The size is a parameter rather than fixed classes
 * because the same file is the 26px lockup in the header, the 52px plate on the
 * verify screen and the favicon in the browser tab.
 */
export function BrandSeal({ size = 26 }: { size?: number }) {
  return (
    <img
      src={BRAND_ASSETS.icon}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className="block shrink-0 select-none"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The full mark — both phones, the ribbon, the medallion — at whatever width it
 * is handed, as the supplied artwork itself.
 *
 * `size` is the mark's width and the height follows from the artwork's own
 * aspect, so the logo never floats in a box of dead space. The file is the same
 * one the PDF statement stamps on its letterhead, so the two cannot drift.
 */
export function BrandMarkImage({
  size = 96,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={BRAND_ASSETS.mark}
      alt={`${BRAND.name} logo`}
      width={size}
      height={markHeight(size)}
      draggable={false}
      className={cx("block select-none", className)}
      style={{ width: size, height: markHeight(size) }}
    />
  );
}

/**
 * The wordmark: the seal next to the name, nothing else.
 *
 * One lockup, used everywhere the app says its own name — the home header, the
 * login card, the QR slip. It has no tagline: "Your digital wallet" sat under
 * the name on the login card and turned a logo into a paragraph, so the lockup
 * is now the two things a logo is made of. The name is read from `BRAND`, so a
 * screen that shows the wordmark can never spell the brand differently.
 *
 * The scale is a parameter rather than a second lockup, because the login card
 * wants the logo to carry the screen and the header wants it to sit quietly
 * beside the navigation. One rule — the seal's size and the wordmark's size
 * move together — is what keeps the two from drifting apart.
 */
export function BrandMark({
  invert = false,
  sealSize = 26,
  wordClassName,
  className,
}: {
  invert?: boolean;
  /** The seal's width and height, in pixels. The wordmark scales with it. */
  sealSize?: number;
  /** Type classes for the wordmark, for lockups that set their own size. */
  wordClassName?: string;
  className?: string;
}) {
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <BrandSeal size={sealSize} />
      <span
        className={cx(
          "font-display leading-none font-extrabold tracking-[-0.02em]",
          invert ? "text-ink-25" : "text-ink-900",
          wordClassName ?? "text-[16.5px]",
        )}
      >
        {BRAND.name}
      </span>
    </span>
  );
}

const NAV_ITEMS = [
  { to: "/home", label: "Home", Icon: IconHome },
  { to: "/history", label: "Transactions", Icon: IconReceipt },
] as const;

const NAV_ITEMS_RIGHT = [
  { to: "/my-qr", label: "QR", Icon: IconQr },
  { to: "/profile", label: "You", Icon: IconUser },
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
          "flex flex-1 flex-col items-center gap-1 rounded-[8px] py-1 text-[10.5px] font-semibold transition",
          isActive ? "text-ink-25" : "text-ink-400 hover:text-ink-200",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cx(
              "flex h-7 w-11 items-center justify-center rounded-[6px] transition-colors",
              isActive && "bg-ink-700",
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
      // z-30: the raised Pay bubble hangs into the scroll area, and the scroll
      // area is its own stacking context (the enter animation transforms it), so
      // without this the page content paints over the top of the bubble.
      className="relative z-30 shrink-0 border-t border-ink-800 bg-ink-900 pb-[max(0.45rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-stretch px-2 pt-2">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <button
          type="button"
          onClick={() => {
            feedback.tap();
            onPay?.();
          }}
          aria-label="Pay, request or add money"
          className="flex flex-1 flex-col items-center justify-end gap-1 text-[10.5px] font-semibold text-ink-300"
        >
          <span className="-mt-6 flex size-12 items-center justify-center rounded-full bg-seal-500 text-paper-25 ring-4 ring-ink-900 transition hover:bg-seal-400 active:translate-y-px active:bg-seal-600">
            {/* A plus, not the scan reticle: this opens the payment sheet, and
                the reticle promised a camera that never opened. Scan keeps its
                own button on the home screen, where it does scan. */}
            <IconPlus size={24} strokeWidth={2.2} />
          </span>
          <span>Pay</span>
        </button>

        {NAV_ITEMS_RIGHT.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
