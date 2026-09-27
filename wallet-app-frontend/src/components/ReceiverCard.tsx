import { cx } from "../lib/cx";
import { Avatar } from "./ui/Avatar";
import { IconWarning } from "./ui/Icons";
import { Spinner } from "./ui/Spinner";

export interface ReceiverCardProps {
  name: string | null;
  vpa: string | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

/** Shows who is about to be paid, including the lookup states in between. */
export function ReceiverCard({
  name,
  vpa,
  loading = false,
  error = null,
  className,
}: ReceiverCardProps) {
  if (error) {
    return (
      <div
        className={cx(
          "flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4",
          className,
        )}
        role="alert"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
          <IconWarning size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-rose-900">Recipient not found</p>
          <p className="truncate text-[12.5px] text-rose-700">{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cx(
          "flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4",
          className,
        )}
        aria-busy="true"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <Spinner size={18} className="text-slate-400" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-slate-700">Finding recipient…</p>
          <p className="truncate text-[12.5px] text-slate-500">{vpa}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4",
        className,
      )}
    >
      <Avatar name={name ?? vpa} size="md" tone="gradient" />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-slate-900">{name ?? "Recipient"}</p>
        <p className="truncate text-[12.5px] text-slate-500 tabular-nums">{vpa}</p>
      </div>
    </div>
  );
}
