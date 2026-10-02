import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Button } from "./Button";
import { IconRefresh, IconWarning } from "./Icons";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon ? (
        <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          {icon}
        </span>
      ) : null}
      <p className="text-[15px] font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-slate-500">{description}</p>
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
      <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
        <IconWarning size={22} />
      </span>
      <p className="text-[15px] font-semibold text-slate-800">Something went wrong</p>
      <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-slate-500">{message}</p>
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
      className={cx("animate-pulse rounded-md bg-slate-200/80", className)}
      aria-hidden="true"
    />
  );
}

/** Rows that mirror the real transaction list layout while it loads. */
export function TransactionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-1 py-3">
          <Bar className="size-10 rounded-full" />
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

/** A placeholder shaped like one of the offer cards while the strip loads. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-2xl bg-slate-100 p-3.5", className)}
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
      <Bar className="h-3 w-24 bg-white/30" />
      <Bar className="h-8 w-44 bg-white/30" />
      <Bar className="h-3 w-36 bg-white/20" />
    </div>
  );
}
