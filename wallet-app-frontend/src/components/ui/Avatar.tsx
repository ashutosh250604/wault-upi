import { cx } from "../../lib/cx";
import { initials } from "../../lib/format";
import type { AvatarTone } from "../../lib/avatar";

// Stamps, not circles: a person reads as a small printed mark.
const BOX = {
  sm: "size-8 rounded-[6px]",
  md: "size-10 rounded-[8px]",
  lg: "size-12 rounded-[10px]",
  xl: "size-16 rounded-[12px]",
} as const;

const TEXT = {
  sm: "text-[11px]",
  md: "text-[12.5px]",
  lg: "text-[15px]",
  xl: "text-[19px]",
} as const;

/** A bank mark can run to four characters; give it room to stay inside the box. */
const TEXT_LONG = {
  sm: "text-[8.5px]",
  md: "text-[10px]",
  lg: "text-[11.5px]",
  xl: "text-[15px]",
} as const;

const TONES: Record<AvatarTone, string> = {
  ink: "bg-ink-900 text-ink-25",
  paper: "bg-paper-100 text-ink-800 ring-1 ring-paper-300 ring-inset",
  cobalt: "bg-press-cobalt text-ink-25",
  teal: "bg-press-teal text-ink-25",
  olive: "bg-press-olive text-ink-25",
  clay: "bg-press-clay text-ink-25",
  plum: "bg-press-plum text-ink-25",
  carbon: "bg-press-carbon text-ink-25",
};

export interface AvatarProps {
  name?: string | null;
  /** Overrides the derived initials — institutions stamp their own short code. */
  label?: string;
  size?: keyof typeof BOX;
  tone?: AvatarTone;
  className?: string;
}

export function Avatar({
  name,
  label,
  size = "md",
  tone = "ink",
  className,
}: AvatarProps) {
  const content = label ?? initials(name);

  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-display font-bold tracking-tight",
        BOX[size],
        content.length >= 4 ? TEXT_LONG[size] : TEXT[size],
        TONES[tone],
        className,
      )}
    >
      {content}
    </span>
  );
}

const BADGE_TONES = {
  success: "bg-credit-50 text-credit-700 ring-credit-100",
  pending: "bg-pending-50 text-pending-700 ring-pending-100",
  failed: "bg-seal-50 text-seal-700 ring-seal-100",
  neutral: "bg-paper-100 text-ink-600 ring-ink-200",
  brand: "bg-ink-900 text-ink-25 ring-ink-900",
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
        "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
