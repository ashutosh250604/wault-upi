import { cx } from "../../lib/cx";
import { initials } from "../../lib/format";

const SIZES = {
  sm: "size-8 text-[11px]",
  md: "size-10 text-[13px]",
  lg: "size-12 text-[15px]",
  xl: "size-16 text-xl",
} as const;

const TONES = {
  brand: "bg-brand-100 text-brand-700",
  slate: "bg-slate-100 text-slate-600",
  emerald: "bg-emerald-100 text-emerald-700",
  gradient: "bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white",
} as const;

export interface AvatarProps {
  name?: string | null;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  className?: string;
}

export function Avatar({
  name,
  size = "md",
  tone = "brand",
  className,
}: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const BADGE_TONES = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  pending: "bg-amber-50 text-amber-700 ring-amber-600/15",
  failed: "bg-rose-50 text-rose-700 ring-rose-600/15",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/15",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/15",
} as const;

export interface BadgeProps {
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  children: React.ReactNode;
}

export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
