import type { HTMLAttributes } from "react";
import { cx } from "../../lib/cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` removes the border for cards sitting on a coloured backdrop. */
  tone?: "default" | "flat" | "muted";
  padded?: boolean;
}

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
        "rounded-2xl",
        padded && "p-4",
        tone === "default" && "border border-slate-200/80 bg-white shadow-sm",
        tone === "flat" && "bg-white",
        tone === "muted" && "bg-slate-50",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cx("text-[13px] font-semibold tracking-wide text-slate-500 uppercase", className)}>
      {children}
    </h2>
  );
}
