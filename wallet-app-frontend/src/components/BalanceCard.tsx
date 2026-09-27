import { useState } from "react";
import { cx } from "../lib/cx";
import { formatCurrency } from "../lib/format";
import { useCopy } from "../hooks/useCopy";
import { BalanceSkeleton } from "./ui/States";
import { IconCheck, IconCopy, IconEye, IconEyeOff, IconRefresh } from "./ui/Icons";
import { Spinner } from "./ui/Spinner";

const HIDE_KEY = "pocketpay.hideBalance";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface BalanceCardProps {
  balance: number | null;
  vpa: string | null;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function BalanceCard({
  balance,
  vpa,
  loading = false,
  refreshing = false,
  onRefresh,
}: BalanceCardProps) {
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
    <section
      aria-label="Wallet balance"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-fuchsia-600 p-5 text-white shadow-lg shadow-brand-900/20"
    >
      {/* Decorative highlights — purely visual. */}
      <span className="pointer-events-none absolute -top-20 -right-14 size-48 rounded-full bg-white/10" />
      <span className="pointer-events-none absolute -bottom-24 -left-12 size-52 rounded-full bg-white/5" />

      <div className="relative">
        <div className="flex items-start justify-between">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-white/70 uppercase">
            Available balance
          </p>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh balance and history"
              className="-mt-1 -mr-1 rounded-full p-2 text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-60"
            >
              {refreshing ? <Spinner size={16} /> : <IconRefresh size={16} />}
            </button>
          ) : null}
        </div>

        <div className="mt-1.5 flex items-center gap-2.5">
          {loading ? (
            <BalanceSkeleton />
          ) : (
            <>
              <p className="text-[2rem] leading-tight font-bold tracking-tight tabular-nums">
                {hidden ? "₹ ••••••" : formatCurrency(balance ?? 0)}
              </p>
              <button
                type="button"
                onClick={toggleHidden}
                aria-label={hidden ? "Show balance" : "Hide balance"}
                aria-pressed={hidden}
                className="rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                {hidden ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </>
          )}
        </div>

        {vpa ? (
          <button
            type="button"
            onClick={() => void copy(vpa)}
            aria-label={`Copy UPI ID ${vpa}`}
            className={cx(
              "mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[12.5px] font-medium",
              "backdrop-blur transition hover:bg-white/25",
            )}
          >
            <span className="tabular-nums">{vpa}</span>
            {copied ? (
              <IconCheck size={14} className="text-emerald-200" />
            ) : (
              <IconCopy size={14} className="text-white/70" />
            )}
          </button>
        ) : null}
      </div>
    </section>
  );
}
