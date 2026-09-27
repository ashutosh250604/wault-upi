import { cx } from "../../lib/cx";

export interface StepDotsProps {
  total: number;
  /** 1-based index of the active step. */
  current: number;
}

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
            "h-1.5 rounded-full transition-all",
            index + 1 === current ? "w-5 bg-brand-600" : "w-1.5 bg-slate-200",
          )}
        />
      ))}
    </span>
  );
}
