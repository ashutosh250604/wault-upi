import { cx } from "../lib/cx";
import { Avatar } from "./ui/Avatar";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "./ui/IconTile";
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
          "flex items-center gap-3 rounded-[10px] border-[1.5px] border-seal-300 bg-seal-50 p-3.5",
          className,
        )}
        role="alert"
      >
        <IconTile tone="seal" scale="md">
          <IconWarning size={TILE_GLYPH.md} strokeWidth={TILE_STROKE} />
        </IconTile>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-seal-900">Recipient not found</p>
          <p className="truncate text-[12.5px] text-seal-700">{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cx(
          "flex items-center gap-3 rounded-[10px] border-[1.5px] border-ink-900/75 bg-paper-25 p-3.5",
          className,
        )}
        aria-busy="true"
      >
        <IconTile tone="muted" scale="md">
          <Spinner size={TILE_GLYPH.md} className="text-ink-500" />
        </IconTile>
        <div>
          <p className="text-[14px] font-semibold text-ink-700">Finding recipient…</p>
          <p className="truncate font-mono text-[12px] text-ink-500">{vpa}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-[10px] border-[1.5px] border-ink-900/75 bg-paper-25 p-3.5",
        className,
      )}
    >
      <Avatar name={name ?? vpa} size="md" tone="ink" />
      <div className="min-w-0">
        <p className="truncate font-display text-[15.5px] font-bold tracking-tight text-ink-900">
          {name ?? "Recipient"}
        </p>
        <p className="truncate font-mono text-[12px] text-ink-500 tabular-nums">{vpa}</p>
      </div>
    </div>
  );
}
