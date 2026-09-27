import { IconRefresh } from "./Icons";

export interface PullIndicatorProps {
  distance: number;
  progress: number;
  refreshing: boolean;
}

/** Collapsible strip that follows the finger and doubles as the refresh spinner. */
export function PullIndicator({ distance, progress, refreshing }: PullIndicatorProps) {
  if (distance === 0 && !refreshing) return null;

  const label = refreshing
    ? "Refreshing…"
    : progress >= 1
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden bg-white"
      style={{ height: distance }}
      role={refreshing ? "status" : undefined}
    >
      <div className="flex items-center gap-2 text-slate-400">
        <IconRefresh
          size={16}
          className={refreshing ? "animate-spin text-brand-600" : undefined}
          style={
            refreshing
              ? undefined
              : { transform: `rotate(${Math.round(progress * 220)}deg)`, opacity: 0.45 + progress * 0.55 }
          }
        />
        <span className="text-[12px] font-semibold">{label}</span>
      </div>
    </div>
  );
}
