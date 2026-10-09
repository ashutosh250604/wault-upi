import { useState } from "react";
import type { Reward } from "../types";
import { cx } from "../lib/cx";
import { formatCurrency, formatDayLabel } from "../lib/format";
import { useRewards } from "../hooks/useRewards";
import { Button } from "./ui/Button";
import { SectionTitle } from "./ui/Card";
import { Coin } from "./ui/Coin";
import { Sheet } from "./ui/Sheet";
import { IconCheck, IconChevronRight } from "./ui/Icons";
import { SkeletonCard } from "./ui/States";

/** "0 of 3 payments" — the one line that says how far along an offer is. */
function progressLabel(reward: Reward): string {
  if (reward.status === "credited") return "Credited";
  if (reward.status === "expired") return "Expired";
  const unit = reward.progress === 1 ? reward.unit : `${reward.unit}s`;
  return `${reward.progress} of ${reward.target} ${unit}`;
}

/** Coupon progress: one rule per step, filled as the ledger confirms them. */
function ProgressBar({ reward, onEdge = false }: { reward: Reward; onEdge?: boolean }) {
  const done = reward.status === "credited";
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: Math.max(reward.target, 1) }).map((_, index) => (
        <span
          key={index}
          className={cx(
            "h-1.5 flex-1 rounded-full",
            index < reward.progress
              ? done
                ? "bg-credit-600"
                : onEdge
                  ? "bg-seal-500"
                  : "bg-ink-900"
              : onEdge
                ? "bg-paper-25/30"
                : "bg-ink-200",
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
        "rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold",
        reward.status === "credited"
          ? "bg-credit-50 text-credit-700"
          : reward.status === "expired"
            ? "bg-paper-200 text-ink-500"
            : "bg-ink-900 text-ink-25",
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
      <div className="relative overflow-hidden rounded-[10px] bg-ink-900 p-4 text-ink-25">
        <span className="pointer-events-none absolute -top-8 -right-6 size-20 rounded-full bg-paper-25/10" />
        {/* The payout is coins, and it is shown as coins: the same medallion the
            balance chip and the scratch card use, so an offer's reward and a
            payment's reward are visibly the same thing. */}
        <p className="relative flex items-center gap-2 font-display text-[1.7rem] leading-none font-extrabold tracking-[-0.02em] tabular-nums">
          <Coin size={26} />
          {reward.coins} {reward.coins === 1 ? "coin" : "coins"}
        </p>
        <p className="relative mt-1.5 text-[12.5px] text-ink-300">
          {reward.headline} · worth {formatCurrency(reward.reward)}
        </p>
        <div className="relative mt-3">
          <ProgressBar reward={reward} onEdge />
        </div>
        <p className="relative mt-2 text-[11.5px] font-semibold text-ink-200">
          {progressLabel(reward)}
        </p>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-ink-600">{reward.detail}</p>

      <dl className="mt-4 space-y-2.5 text-[12.5px]">
        <div className="flex items-start justify-between gap-4 border-b border-dashed border-ink-200 pb-2.5">
          <dt className="text-ink-500">Status</dt>
          <dd>
            <StatusChip reward={reward} />
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-dashed border-ink-200 pb-2.5">
          <dt className="text-ink-500">Progress</dt>
          <dd className="font-semibold text-ink-800 tabular-nums">
            {reward.progress} / {reward.target}
          </dd>
        </div>
        {reward.credited_at ? (
          <div className="flex items-start justify-between gap-4">
            <dt className="text-ink-500">Credited</dt>
            <dd className="font-semibold text-ink-800">
              {formatDayLabel(reward.credited_at)}
            </dd>
          </div>
        ) : null}
        {reward.expires_at ? (
          <div className="flex items-start justify-between gap-4">
            <dt className="text-ink-500">Ends</dt>
            <dd className="font-semibold text-ink-800">{formatDayLabel(reward.expires_at)}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 border-t border-ink-200 pt-3 text-[11.5px] leading-relaxed text-ink-500">
        Offers pay in coins, never in cash: they land in your coin balance as soon as the
        payment that earns them settles, and 10 coins redeem for ₹10.
      </p>
    </Sheet>
  );
}

/**
 * An offer reads as a coupon: an inked head with the reward's name, the terms
 * below it, and a hard print shadow that lifts the whole ticket off the warm
 * page. Status is still the ledger's — nothing here is decorative state.
 */
export function RewardsCard({
  reward,
  onSelect,
  wide = false,
}: {
  reward: Reward;
  onSelect: (reward: Reward) => void;
  /** Stacked full-width in the offers sheet, rather than fixed in the rack. */
  wide?: boolean;
}) {
  const done = reward.status === "credited";

  return (
    <button
      type="button"
      onClick={() => onSelect(reward)}
      className={cx(
        "relative overflow-hidden rounded-[14px] border-[1.5px] border-ink-900 bg-paper-25 text-left",
        wide ? "w-full" : "w-[15rem] shrink-0 snap-start",
        "shadow-[3px_3px_0_0_rgba(25,25,22,0.85)] transition active:translate-y-px active:shadow-[1px_1px_0_0_rgba(25,25,22,0.85)]",
      )}
    >
      <span className="flex items-center justify-between gap-2 bg-ink-900 px-3.5 py-2 text-ink-25">
        <span className="min-w-0 truncate font-display text-[13.5px] font-bold tracking-tight">
          {reward.title}
        </span>
        {done ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-credit-600 text-paper-25">
            <IconCheck size={12} />
          </span>
        ) : (
          <Coin size={16} className="shrink-0" />
        )}
      </span>

      <span className="block px-3.5 pt-3 pb-3.5">
        <span className="block text-[11.5px] leading-snug text-ink-500">{reward.headline}</span>

        <span className="mt-3 block">
          <ProgressBar reward={reward} />
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-ink-600">
            {progressLabel(reward)}
          </span>
          <span className="text-[11.5px] font-semibold text-ink-900 underline decoration-ink-300 decoration-1 underline-offset-4">
            {done ? "See terms" : "How"}
          </span>
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
export function OffersStrip({
  reloadKey,
  compact = false,
}: {
  reloadKey?: unknown;
  /**
   * One line instead of the rack: what the home screen uses, so the whole page
   * fits one screen without losing the offers — the tickets open in a sheet
   * from the chip. The card itself is unchanged, because the offer is the same
   * offer wherever it is read.
   */
  compact?: boolean;
}) {
  const { rewards, status, reload } = useRewards(reloadKey);
  const [selected, setSelected] = useState<Reward | null>(null);
  const [listOpen, setListOpen] = useState(false);

  // Drop offers the catalogue no longer describes rather than rendering an
  // empty shell.
  const visible = (rewards ?? []).filter((reward) => reward.status !== "expired").slice(0, 4);
  // The chip leads with the one still worth working on, not the one already
  // banked — a credited offer is a receipt, not a nudge.
  const lead = visible.find((reward) => reward.status !== "credited") ?? visible[0];

  // The rack is inset one notch past the page gutter and scrolls full-bleed, so
  // the first ticket never looks stuck to the screen edge.
  const RACK = "no-scrollbar -mx-5 flex gap-3 overflow-x-auto pl-6 pr-5 pt-0.5 pb-2 scroll-pl-6";

  const offEmpty = rewards !== null && visible.length === 0;

  if (compact) {
    return (
      <section aria-label="Offers">
        {status === "loading" && rewards === null ? (
          <div className="h-10 animate-shimmer rounded-[10px] border-[1.5px] border-ink-900/25 bg-paper-100" />
        ) : null}

        {status === "error" && rewards === null ? (
          <p className="rounded-[10px] border border-dashed border-ink-300 px-3 py-2 text-[12px] text-ink-500">
            Offers are unavailable right now.{" "}
            <button
              type="button"
              onClick={reload}
              className="font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-2"
            >
              Try again
            </button>
          </p>
        ) : null}

        {lead ? (
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-[10px] border-[1.5px] border-ink-900/35 bg-paper-25 px-2.5 py-2 text-left transition",
              "shadow-[2px_2px_0_0_rgba(25,25,22,0.6)] hover:bg-paper-100 active:translate-y-px active:shadow-none",
              "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-ink-900 bg-ink-900 text-paper-25">
              <Coin size={16} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink-900">
              {lead.title}
              <span className="font-medium text-ink-500"> · {lead.headline}</span>
            </span>
            <span className="shrink-0 text-[11.5px] font-semibold text-ink-600">
              {progressLabel(lead)}
            </span>
            <IconChevronRight size={15} className="shrink-0 text-ink-500" />
          </button>
        ) : null}

        {offEmpty ? (
          <p className="rounded-[10px] border border-dashed border-ink-300 px-3 py-2 text-[12px] text-ink-500">
            No offers are running on this account right now.
          </p>
        ) : null}

        <Sheet
          open={listOpen}
          onClose={() => setListOpen(false)}
          title="Offers for you"
          description="Every offer here pays in coins, credited in the same moment as the payment that earns it."
        >
          <div className="flex flex-col gap-3.5">
            {visible.map((reward) => (
              <RewardsCard
                key={reward.code}
                reward={reward}
                wide
                onSelect={(next) => {
                  setListOpen(false);
                  setSelected(next);
                }}
              />
            ))}
          </div>
        </Sheet>

        <RewardSheet
          reward={selected}
          open={selected !== null}
          onClose={() => setSelected(null)}
        />
      </section>
    );
  }

  return (
    <section aria-label="Offers" className="pl-1">
      <SectionTitle className="mb-2">Offers for you</SectionTitle>

      {status === "loading" && rewards === null ? (
        <div className={RACK}>
          <SkeletonCard className="w-[15rem]" />
          <SkeletonCard className="w-[15rem]" />
        </div>
      ) : null}

      {status === "error" && rewards === null ? (
        <p className="rounded-[10px] border border-dashed border-ink-300 px-3 py-2.5 text-[12.5px] text-ink-500">
          Offers are unavailable right now.{" "}
          <button type="button" onClick={reload} className="font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-2">
            Try again
          </button>
        </p>
      ) : null}

      {rewards !== null && visible.length > 0 ? (
        <div className={cx(RACK, "snap-x snap-mandatory")}>
          {visible.map((reward) => (
            <RewardsCard key={reward.code} reward={reward} onSelect={setSelected} />
          ))}
        </div>
      ) : null}

      {rewards !== null && visible.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-ink-300 px-3 py-2.5 text-[12.5px] text-ink-500">
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
