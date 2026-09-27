import { cx } from "../../lib/cx";
import { useCopy } from "../../hooks/useCopy";
import { IconCheck, IconCopy } from "./Icons";

export interface CopyButtonProps {
  value: string;
  /** Accessible label, e.g. "Copy UPI ID". */
  label: string;
  /** Optional visible text next to the icon. */
  children?: React.ReactNode;
  size?: number;
  className?: string;
  onCopied?: (ok: boolean) => void;
}

export function CopyButton({
  value,
  label,
  children,
  size = 16,
  className,
  onCopied,
}: CopyButtonProps) {
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      aria-label={copied ? `${label} — copied` : label}
      onClick={async () => {
        const ok = await copy(value);
        onCopied?.(ok);
      }}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg font-semibold transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1",
        copied ? "text-emerald-600" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
        children ? "px-2 py-1 text-[12px]" : "p-1.5",
        className,
      )}
    >
      {copied ? <IconCheck size={size} /> : <IconCopy size={size} />}
      {children ? <span>{copied ? "Copied" : children}</span> : null}
    </button>
  );
}
