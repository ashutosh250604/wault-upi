import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Button } from "./Button";
import { TILE_GLYPH, TILE_STROKE, type IconTone } from "../../lib/tiles";
import { IconTile } from "./IconTile";
import { IconRefresh, IconWarning } from "./Icons";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  iconTone = "muted",
  iconSolid = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** The tile's colour. Worth setting when the state sits on paper, not a slip. */
  iconTone?: IconTone;
  /** Fills the tile, for a state that owns a coloured panel of its own. */
  iconSolid?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon ? (
        // The same tile a row wears, one step up: a state's mark and a list's
        // mark are the same object at two sizes.
        <IconTile tone={iconTone} scale="lg" solid={iconSolid} className="mb-3">
          {icon}
        </IconTile>
      ) : null}
      <p className="font-display text-[15.5px] font-bold tracking-tight text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-8 text-center", className)}>
      <IconTile tone="seal" scale="lg" className="mb-3">
        <IconWarning size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />
      </IconTile>
      <p className="font-display text-[15.5px] font-bold tracking-tight text-ink-900">
        Something went wrong
      </p>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-500">{message}</p>
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          leftIcon={<IconRefresh size={15} />}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-[4px] bg-paper-300/70", className)}
      aria-hidden="true"
    />
  );
}

/** Rows that mirror the real transaction list layout while it loads. */
export function TransactionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-ink-200/70" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-1 py-3.5">
          <Bar className="size-10 rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <Bar className="h-3.5 w-32" />
            <Bar className="h-3 w-20" />
          </div>
          <Bar className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A placeholder shaped like one of the offer slips while the strip loads. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-[10px] border-[1.5px] border-ink-200 bg-paper-25 p-3.5", className)}
      aria-hidden="true"
    >
      <Bar className="h-3.5 w-24" />
      <Bar className="mt-2 h-3 w-32" />
      <Bar className="mt-3.5 h-1.5 w-full" />
    </div>
  );
}

export function BalanceSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden="true">
      <Bar className="h-3 w-24 bg-ink-600/70" />
      <Bar className="h-9 w-44 bg-ink-600/70" />
      <Bar className="h-3 w-36 bg-ink-600/50" />
    </div>
  );
}
