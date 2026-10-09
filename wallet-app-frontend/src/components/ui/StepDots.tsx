import { cx } from "../../lib/cx";

export interface StepDotsProps {
  total: number;
  /** 1-based index of the active step. */
  current: number;
}

/** Onboarding progress as rule marks — a sequence, so numbering is honest. */
export function StepDots({ total, current }: StepDotsProps) {
  return (
    <span
      className="flex items-center gap-1.5 pr-2"
      role="img"
      aria-label={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={index}
          className={cx(
            "h-[3px] w-6 rounded-full transition-colors",
            index + 1 === current ? "bg-seal-500" : "bg-ink-200",
          )}
        />
      ))}
    </span>
  );
}
