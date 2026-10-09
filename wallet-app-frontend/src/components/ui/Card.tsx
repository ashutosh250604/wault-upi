import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` removes the border for slips sitting on a coloured backdrop. */
  tone?: "default" | "flat" | "muted";
  padded?: boolean;
}

/**
 * A slip: inked hairline edge, square-ish corners, no drop shadow. Elevation is
 * reserved for things that genuinely float (sheets, toasts, the phone frame),
 * which is why most of the app uses rules and spacing instead. The edge is a
 * full step heavier than a hairline so a slip is drawn, not implied by a
 * slightly different shade of near-white.
 */
export function Card({
  tone = "default",
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        "rounded-[10px]",
        padded && "p-4",
        tone === "default" && "border-[1.5px] border-ink-900/75 bg-paper-25",
        tone === "flat" && "bg-paper-25",
        tone === "muted" && "bg-paper-100 ring-1 ring-ink-200/70 ring-inset",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cx("font-display text-[15px] font-bold tracking-tight text-ink-900", className)}>
      {children}
    </h2>
  );
}

/** Section heading for ledger-style lists. */
export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3", className)}>
      <h2 className="font-display text-[15.5px] font-bold tracking-tight text-ink-900">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** The quiet text link used at the end of section headings. */
export function TextLink({
  children,
  className,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a
      className={cx(
        "text-[12.5px] font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4 transition hover:decoration-seal-600",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}
