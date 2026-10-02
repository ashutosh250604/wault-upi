import { useState } from "react";
import type { Reward } from "../types";
import { cx } from "../lib/cx";
import { formatCurrency, formatDayLabel } from "../lib/format";
import { useRewards } from "../hooks/useRewards";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";
import { IconChevronRight, IconSpark } from "./ui/Icons";
import { SkeletonCard } from "./ui/States";

/**
 * Presentation for each offer. The catalogue's terms live on the server; only
 * the colour it paints itself in lives here.
 */
const TONES: Record<string, string> = {
  first_topup: "from-emerald-500 to-teal-600",
  three_payments: "from-brand-500 to-fuchsia-600",
  first_money_in: "from-amber-500 to-orange-600",
};

const FALLBACK_TONE = "from-slate-600 to-slate-700";

function toneFor(code: string): string {
  return TONES[code] ?? FALLBACK_TONE;
}

/** "0 of 3 payments" — the one line that says how far along an offer is. */
function progressLabel(reward: Reward): string {
  if (reward.status === "credited") return "Credited";
  if (reward.status === "expired") return "Expired";
  const unit = reward.progress === 1 ? reward.unit : `${reward.unit}s`;
  return `${reward.progress} of ${reward.target} ${unit}`;
}

function ProgressBar({ reward, invert = false }: { reward: Reward; invert?: boolean }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: Math.max(reward.target, 1) }).map((_, index) => (
        <span
          key={index}
          className={cx(
            "h-1.5 flex-1 rounded-full",
            index < reward.progress
              ? invert
                ? "bg-white"
                : "bg-brand-600"
              : invert
                ? "bg-white/30"
                : "bg-slate-200",
          )}
        />
      ))}
    </div>
  );
}

function StatusChip({ reward }: { reward: Reward }) {
  const label =
    reward.status === "credited"
      ? "Paid out"
      : reward.status === "expired"
        ? "Expired"
        : "Active";
  return (
    <span
      className={cx(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        reward.status === "credited"
          ? "bg-emerald-50 text-emerald-700"
          : reward.status === "expired"
            ? "bg-slate-100 text-slate-500"
            : "bg-brand-50 text-brand-700",
      )}
    >
      {label}
    </span>
  );
}

export function RewardSheet({
  reward,
  open,
  onClose,
}: {
  reward: Reward | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!reward) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={reward.title}
      description={reward.headline}
      footer={
        <Button fullWidth onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div
        className={cx(
          "relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white",
          toneFor(reward.code),
        )}
      >
        <span className="pointer-events-none absolute -top-8 -right-6 size-20 rounded-full bg-white/15" />
        <p className="relative text-2xl font-bold">{formatCurrency(reward.reward)}</p>
        <p className="relative mt-0.5 text-[12.5px] text-white/85">{reward.headline}</p>
        <div className="relative mt-3">
          <ProgressBar reward={reward} invert />
        </div>
        <p className="relative mt-2 text-[11.5px] font-semibold text-white/90">
          {progressLabel(reward)}
        </p>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-slate-600">{reward.detail}</p>

      <dl className="mt-4 space-y-2.5 text-[12.5px]">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-slate-500">Status</dt>
          <dd>
            <StatusChip reward={reward} />
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-slate-500">Progress</dt>
          <dd className="font-semibold text-slate-800 tabular-nums">
            {reward.progress} / {reward.target}
          </dd>
        </div>
        {reward.credited_at ? (
          <div className="flex items-start justify-between gap-4">
            <dt className="text-slate-500">Credited</dt>
            <dd className="font-semibold text-slate-800">
              {formatDayLabel(reward.credited_at)}
            </dd>
          </div>
        ) : null}
        {reward.expires_at ? (
          <div className="flex items-start justify-between gap-4">
            <dt className="text-slate-500">Ends</dt>
            <dd className="font-semibold text-slate-800">{formatDayLabel(reward.expires_at)}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 border-t border-slate-100 pt-3 text-[11.5px] leading-relaxed text-slate-500">
        Cashback is credited to your Wallet Pay balance as a normal transaction — it shows up in
        your history and in any statement you download, like every other movement.
      </p>
    </Sheet>
  );
}

export function RewardsCard({
  reward,
  onSelect,
}: {
  reward: Reward;
  onSelect: (reward: Reward) => void;
}) {
  const done = reward.status === "credited";

  return (
    <button
      type="button"
      onClick={() => onSelect(reward)}
      className={cx(
        "relative w-[13.5rem] shrink-0 snap-start overflow-hidden rounded-2xl bg-gradient-to-br p-3.5 text-left text-white shadow-sm transition active:scale-[0.98]",
        done ? "from-slate-600 to-slate-700" : toneFor(reward.code),
      )}
    >
      <span className="pointer-events-none absolute -top-8 -right-6 size-20 rounded-full bg-white/15" />
      <span className="relative flex items-start justify-between gap-2">
        <span>
          <span className="block text-[14.5px] font-bold">{reward.title}</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-white/85">
            {reward.headline}
          </span>
        </span>
        {done ? <IconSpark size={15} className="mt-0.5 shrink-0 text-amber-300" /> : null}
      </span>

      <span className="relative mt-3 block">
        <ProgressBar reward={reward} invert />
      </span>
      <span className="relative mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-white/90">{progressLabel(reward)}</span>
        <span className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold">
          {done ? "See terms" : "How"} <IconChevronRight size={13} />
        </span>
      </span>
    </button>
  );
}

/**
 * Offers for this account.
 *
 * Nothing here is decorative: progress comes from the ledger on the server, and
 * completing an offer credits the balance inside the same commit as the payment
 * that completed it. `reloadKey` is the newest transaction, which is exactly the
 * signal that something may have just been earned.
 */
export function OffersStrip({ reloadKey }: { reloadKey?: unknown }) {
  const { rewards, status, reload } = useRewards(reloadKey);
  const [selected, setSelected] = useState<Reward | null>(null);

  // Drop offers the catalogue no longer describes rather than rendering an
  // empty shell.
  const visible = (rewards ?? []).filter((reward) => reward.status !== "expired").slice(0, 4);

  return (
    <section aria-label="Offers">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-bold tracking-tight text-slate-900">Offers for you</h2>
        <button
          type="button"
          onClick={reload}
          className="rounded-lg px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-400 transition hover:text-slate-600"
        >
          Refresh
        </button>
      </div>

      {status === "loading" && rewards === null ? (
        <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
          <SkeletonCard className="w-[13.5rem]" />
          <SkeletonCard className="w-[13.5rem]" />
        </div>
      ) : null}

      {status === "error" && rewards === null ? (
        <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-500">
          Offers are unavailable right now.{" "}
          <button type="button" onClick={reload} className="font-semibold text-brand-700">
            Try again
          </button>
        </p>
      ) : null}

      {rewards !== null && visible.length > 0 ? (
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
          {visible.map((reward) => (
            <RewardsCard key={reward.code} reward={reward} onSelect={setSelected} />
          ))}
        </div>
      ) : null}

      {rewards !== null && visible.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-500">
          No offers are running on this account right now.
        </p>
      ) : null}

      <RewardSheet
        reward={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
