import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx";
import { feedback } from "../../lib/feedback";

export interface KeypadButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Secondary keys (00, backspace) read quieter than the digits. */
  muted?: boolean;
  /** Wider key, e.g. the `00` on the amount pad. */
  wide?: boolean;
}

export function KeypadButton({
  muted = false,
  wide = false,
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
        "flex h-[3.4rem] items-center justify-center rounded-[6px] font-display font-semibold transition select-none",
        "focus-visible:ring-2 focus-visible:ring-ink-900/35 focus-visible:outline-none",
        // The key physically travels down, like a real till.
        "active:translate-y-px active:bg-paper-200",
        muted
          ? "text-[15px] text-ink-500 hover:bg-paper-100"
          : "text-[23px] text-ink-900 hover:bg-paper-100",
        wide && "col-span-2",
        "disabled:pointer-events-none disabled:opacity-35",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
