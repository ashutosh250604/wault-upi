import type { ReactNode } from "react";

/**
 * Label on the left, value on the right, separated by a dashed rule — the row
 * language of a printed receipt. Shared by receipts, sheets and profile.
 */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dashed border-ink-200 py-3 last:border-b-0">
      <span className="pt-px text-[12.5px] text-ink-500">{label}</span>
      <span className="max-w-[64%] text-right text-[13px] font-medium text-ink-900">
        {children}
      </span>
    </div>
  );
}
