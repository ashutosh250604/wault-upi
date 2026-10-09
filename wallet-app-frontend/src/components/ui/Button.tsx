import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ticket"
  | "ghost"
  | "onDark"
  | "danger"
  | "success";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Ink buttons are the primary action ("pay", "continue"). The sealing red is
 * reserved for destructive confirmation, so a red button always means "this
 * cannot be undone" rather than "this is the main thing".
 *
 * Every variant is an object resting on warm paper, not a flat rectangle:
 * primary carries a hairline of light along its top edge and a soft cast
 * shadow, and secondary is a warm slip with an inked hairline instead of the
 * pale grey ring that read as a default browser button.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  // The disabled primary reads as an un-inked field rather than a washed-out
  // button: at 45% opacity the white label on mid-grey looked like a smudge.
  primary:
    "bg-ink-900 text-paper-25 shadow-[inset_0_1px_0_rgba(255,250,230,0.16),0_12px_26px_-18px_rgba(15,15,13,0.85)] hover:bg-ink-800 active:bg-ink-950 active:shadow-[inset_0_1px_0_rgba(255,250,230,0.08),0_3px_8px_-6px_rgba(15,15,13,0.9)] disabled:bg-paper-100 disabled:text-ink-400 disabled:shadow-none",
  // Warm slip + inked hairline — a tab pressed into the page rather than a pale
  // grey rectangle. Deep enough that it never reads as the browser's white,
  // quiet enough to line up under an ink button without competing.
  secondary:
    "bg-paper-100 text-ink-900 ring-[1.5px] ring-ink-900 ring-inset shadow-[0_10px_24px_-20px_rgba(15,15,13,0.8)] hover:bg-paper-200 hover:ring-ink-800 active:bg-paper-300 active:shadow-none",
  // A torn coupon: dashed inked edge and a hard print shadow. Used where an
  // action is a side door rather than the main thing (exploring a sample
  // account), so it reads as a deliberate second-class control on warm paper.
  ticket:
    "border-[1.5px] border-dashed border-ink-900/75 bg-paper-100 text-ink-900 shadow-[3px_3px_0_0_rgba(25,25,22,0.75)] hover:border-ink-900 hover:bg-paper-200 active:translate-y-px active:bg-paper-300 active:shadow-none",
  ghost: "text-ink-700 hover:bg-paper-100 active:bg-paper-200",  // Quiet outline for the dark surfaces (the camera): light ink on a light
  // rule, so it reads as a button instead of a label floating on black.
  onDark:
    "text-ink-100 ring-1 ring-ink-600 ring-inset hover:bg-ink-800 hover:ring-ink-500 active:bg-ink-900",
  danger:
    "bg-seal-600 text-paper-25 shadow-[inset_0_1px_0_rgba(255,250,230,0.2),0_12px_26px_-18px_rgba(120,35,26,0.85)] hover:bg-seal-700 active:bg-seal-800 active:shadow-[inset_0_1px_0_rgba(255,250,230,0.12)]",
  success:
    "bg-credit-600 text-paper-25 shadow-[inset_0_1px_0_rgba(255,250,230,0.2),0_12px_26px_-18px_rgba(20,92,57,0.8)] hover:bg-credit-700",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-[7px] gap-1.5",
  md: "h-11 px-4 text-[14px] rounded-[9px] gap-2",
  lg: "h-[3.25rem] px-5 text-[15px] rounded-[11px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // A loading button must not be clickable twice — that's how double
      // transfers happen.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "relative inline-flex select-none items-center justify-center font-semibold tracking-[-0.01em] whitespace-nowrap",
        // Tactile press: the key moves down, it doesn't shrink into the page.
        "transition duration-100 active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/40 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
        // A disabled primary sets its own colours, so it must not also fade.
        variant === "primary" && "disabled:opacity-100",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? 18 : 16} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
