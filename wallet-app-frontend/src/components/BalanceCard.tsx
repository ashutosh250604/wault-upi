import { useState } from "react";
import { formatCurrency } from "../lib/format";
import { useCopy } from "../hooks/useCopy";
import { BalanceSkeleton } from "./ui/States";
import { IconCheck, IconCopy, IconEye, IconEyeOff, IconRefresh } from "./ui/Icons";
import { Spinner } from "./ui/Spinner";

const HIDE_KEY = "okwault.hideBalance";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The refresh control, on its own.
 *
 * It used to live inside the balance's label row, opposite "Available balance" —
 * a capsule sitting directly above the right-hand end of the hero numeral, at
 * the same weight as the label, so the two fought over the same line. The
 * greeting is the row with space in it, so that is where it goes now: the
 * balance block keeps one label, one numeral and one handle, and nothing else
 * interrupts it.
 */
export function BalanceRefresh({
  refreshing = false,
  onRefresh,
}: {
  refreshing?: boolean;
  onRefresh: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label="Refresh balance and transactions"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] bg-ink-800 px-2.5 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-ink-700 transition hover:bg-ink-700 hover:text-ink-100 active:bg-ink-900 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ink-25 focus-visible:outline-none"
    >
      {refreshing ? <Spinner size={13} /> : <IconRefresh size={13} />}
      {refreshing ? "Refreshing" : "Refresh"}
    </button>
  );
}

export interface BalanceCardProps {
  balance: number | null;
  vpa: string | null;
  loading?: boolean;
}

/**
 * The balance block that lives inside the home screen's ink hero: the amount is
 * the hero numeral, the handle is machine data, and everything else gets out of
 * their way.
 *
 * Three stacked pieces, in descending size and ascending distance from the eye:
 * a small label, the numeral, then the handle as a pill you can copy. The eye
 * toggle rides at the end of the numeral rather than above it, because hiding
 * the balance is a property of the amount and reads as one gesture with it.
 */
export function BalanceCard({ balance, vpa, loading = false }: BalanceCardProps) {
  const [hidden, setHidden] = useState(readHidden);
  const { copied, copy } = useCopy();

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    try {
      window.localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      // Storage is optional; the toggle still works for this session.
    }
  };

  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-400">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-credit-600" />
        Available balance
      </p>

      <div className="mt-1 flex items-center gap-2.5">
        {loading ? (
          <BalanceSkeleton />
        ) : (
          <>
            <p className="font-display text-[2.5rem] leading-none font-extrabold tracking-[-0.035em] tabular-nums text-ink-25">
              {hidden ? "₹ ••••••" : formatCurrency(balance ?? 0)}
            </p>
            <button
              type="button"
              onClick={toggleHidden}
              aria-label={hidden ? "Show balance" : "Hide balance"}
              aria-pressed={hidden}
              className="-mt-0.5 rounded-[6px] p-1.5 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100 focus-visible:ring-2 focus-visible:ring-ink-25 focus-visible:outline-none"
            >
              {hidden ? <IconEyeOff size={17} /> : <IconEye size={17} />}
            </button>
          </>
        )}
      </div>

      {vpa ? (
        <button
          type="button"
          onClick={() => void copy(vpa)}
          aria-label={`Copy UPI ID ${vpa}`}
          className="mt-2.5 inline-flex items-center gap-2 rounded-[6px] bg-ink-800 px-2.5 py-1.5 font-mono text-[12px] text-ink-200 transition hover:bg-ink-700 hover:text-ink-100 focus-visible:ring-2 focus-visible:ring-ink-25 focus-visible:outline-none"
        >
          <span className="tabular-nums">{vpa}</span>
          {copied ? (
            <IconCheck size={14} className="text-credit-100" />
          ) : (
            <IconCopy size={14} className="text-ink-400" />
          )}
        </button>
      ) : null}
    </div>
  );
}
