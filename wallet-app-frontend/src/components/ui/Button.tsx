import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 active:bg-brand-800",
  secondary:
    "bg-white text-slate-800 ring-1 ring-slate-200 ring-inset hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-brand-700 hover:bg-brand-50 active:bg-brand-100",
  danger: "bg-rose-600 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-700",
  success: "bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-lg gap-1.5",
  md: "h-11 px-4 text-sm rounded-xl gap-2",
  lg: "h-[3.25rem] px-5 text-[15px] rounded-2xl gap-2",
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
        "relative inline-flex select-none items-center justify-center font-semibold",
        "transition duration-150 active:scale-[0.985]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
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
