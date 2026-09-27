import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx";
import { feedback } from "../../lib/feedback";

export interface KeypadButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Secondary keys (00, backspace) read quieter than the digits. */
  muted?: boolean;
}

export function KeypadButton({
  muted = false,
  className,
  type = "button",
  onClick,
  children,
  ...rest
}: KeypadButtonProps) {
  return (
    <button
      type={type}
      // One place gives every numeric key its tick and haptic nudge.
      onClick={(event) => {
        feedback.tap();
        onClick?.(event);
      }}
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
