import type { ReactNode } from "react";

/** Label on the left, value on the right — shared by receipts and detail sheets. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-[13px] text-slate-500">{label}</span>
      <span className="max-w-[62%] text-right text-[13.5px] font-medium text-slate-900">
        {children}
      </span>
    </div>
  );
}
