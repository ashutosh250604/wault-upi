import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx";

export interface KeypadButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Secondary keys (00, backspace) read quieter than the digits. */
  muted?: boolean;
}

export function KeypadButton({
  muted = false,
  className,
  type = "button",
  children,
  ...rest
}: KeypadButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "flex h-12 items-center justify-center rounded-xl font-semibold transition select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
        "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40",
        muted
          ? "text-slate-500 hover:bg-slate-100 active:bg-slate-200"
          : "text-xl text-slate-900 hover:bg-slate-100 active:bg-slate-200",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
