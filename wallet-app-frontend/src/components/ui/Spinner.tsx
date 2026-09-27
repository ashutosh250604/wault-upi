import { cx } from "../../lib/cx";

interface SpinnerProps {
  size?: number;
  className?: string;
}

/** Accessible, dependency-free loading spinner. */
export function Spinner({ size = 18, className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx("inline-block shrink-0 animate-spin", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeOpacity="0.25"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
