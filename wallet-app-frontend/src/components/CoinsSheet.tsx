import { useState } from "react";
import { Link } from "react-router-dom";
import type { CoinSnapshot } from "../types";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime } from "../lib/format";
import { useToast } from "../hooks/toast";
import { Button } from "./ui/Button";
import { Coin } from "./ui/Coin";
import { Sheet } from "./ui/Sheet";
import { SkeletonCard } from "./ui/States";
import { IconChevronRight, IconSpark } from "./ui/Icons";

export interface CoinsSheetProps {
  open: boolean;
  onClose: () => void;
  coins: CoinSnapshot | null;
  /** Called with the fresh snapshot after a redemption, so the header updates. */
  onRedeemed?: (coins: CoinSnapshot) => void;
  /** Lets the screen behind the sheet pull a new balance in. */
  onBalanceChanged?: () => void;
}

/**
 * The coin balance, on a slip.
 *
 * This sheet used to explain itself: a paragraph of rule under the title, a
 * three-line progress panel for the next coin, a table of lifetime totals and a
 * footnote about where redeemed coins go. None of it answered the two questions
 * anyone opens a reward screen to ask — how many coins do I have, and can I
 * spend them yet. It says those two things and then gets out of the way: the
 * balance and its worth, the gate (with the payout it unlocks), and the last few
 * payments that paid out, which is all the history this needs.
 *
 * The balance is on ink rather than paper. A coin is metal; the only surface in
 * this app that reads as metal is the print ink, and the supplied gold emblem
 * sits on it the way the header's does. Everything below the panel is the same
 * warm paper as the rest of the app, so the sheet still reads as a slip with a
 * coin struck into the top of it.
 *
 * The figures come off the server's snapshot rather than being restated here, so
 * the minimum, the payout and the value cannot drift from what is enforced — in
 * particular `redeemable` is the whole balance once the gate is clear, not a
 * rounded-down number of tens.
 */
export function CoinsSheet({
  open,
  onClose,
  coins,
  onRedeemed,
  onBalanceChanged,
}: CoinsSheetProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // What the server will pay out right now: the whole balance, or nothing.
  const redeemable = coins?.redeemable ?? 0;
  const canRedeem = redeemable > 0;
  const gate = coins?.min_redeem ?? 10;
  const toGo = coins ? Math.max(0, gate - coins.coins) : 0;
  const met = coins ? Math.min(coins.coins, gate) : 0;

  const onRedeem = async () => {
    if (!coins || busy) return;
    setBusy(true);
    try {
      // No amount: a redemption takes the whole balance.
      const result = await api.redeemCoins();
      // The payout is the moment, so the cue waits for the server to confirm it
      // — a redemption that was refused must not sound like money arriving.
      feedback.redeemed();
      onRedeemed?.(result.coins);
      onBalanceChanged?.();
      toast.success(result.message);
    } catch (err) {
      feedback.error();
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Coins"
      // One line, and only the two things nobody can guess: what a coin is
      // worth, and where the gate is.
      description={`One coin is ${formatCurrency(1)}. Redeem from ${gate}.`}
      footer={
        coins ? (
          <div className="space-y-2">
            <Button
              fullWidth
              size="lg"
              loading={busy}
              disabled={!canRedeem}
              onClick={() => void onRedeem()}
              leftIcon={<Coin size={20} muted={!canRedeem} />}
            >
              {canRedeem
                ? `Redeem ${redeemable} ${redeemable === 1 ? "coin" : "coins"} for ${formatCurrency(
                    coins.redeemable_value,
                  )}`
                : `Redeem from ${gate} coins`}
            </Button>
            {!canRedeem ? (
              <p className="text-center text-[11.5px] font-medium text-ink-500">
                {toGo === 1 ? "1 more coin unlocks it." : `${toGo} more coins unlock it.`}
              </p>
            ) : (
              <p className="text-center text-[11.5px] font-medium text-ink-500">
                All {coins.coins} coins go in one payout — nothing is left behind.
              </p>
            )}
          </div>
        ) : null
      }
    >
      {coins === null ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <>
          {/* The balance, struck into ink: the gold emblem at the size it can
              carry, the count as the hero numeral, and the gate as a meter
              under both. */}
          <div className="relative overflow-hidden rounded-[14px] bg-ink-900 px-4 pt-4 pb-4 text-ink-25">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-5 -bottom-6 opacity-[0.13]"
            >
              <Coin size={104} />
            </span>

            <div className="relative flex items-center gap-4">
              <Coin size={60} className={cx(!canRedeem && "opacity-70")} />
              <div className="min-w-0">
                <p className="font-display text-[2.4rem] leading-none font-extrabold tracking-[-0.03em] tabular-nums">
                  {coins.coins}
                </p>
                <p className="mt-1 text-[12.5px] text-ink-300">
                  {coins.coins === 1 ? "coin" : "coins"} · worth{" "}
                  <span className="font-semibold text-pending-100">
                    {formatCurrency(coins.value)}
                  </span>
                </p>
              </div>
            </div>

            <div className="relative mt-4">
              <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span
                  className={cx(
                    "font-semibold",
                    canRedeem ? "text-credit-100" : "text-pending-100",
                  )}
                >
                  {canRedeem
                    ? `${formatCurrency(coins.redeemable_value)} ready to redeem`
                    : `${toGo} more ${toGo === 1 ? "coin" : "coins"} to ${gate}`}
                </span>
                <span className="font-mono tabular-nums text-ink-400">
                  {met}/{gate}
                </span>
              </div>
              {/* One track, one gate. It fills to the minimum and stays there:
                  coins past it are not progress towards anything, they are
                  simply money. */}
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-700">
                <span
                  className={cx(
                    "block h-full rounded-full transition-[width] duration-500",
                    canRedeem ? "bg-credit-100" : "bg-pending-100",
                  )}
                  style={{ width: `${Math.round((met / gate) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Two figures, side by side, as a printed summary line — the whole
              lifetime of the coin balance without a table around it. */}
          <div className="mt-3 grid grid-cols-2 divide-x divide-ink-200 rounded-[12px] border-[1.5px] border-ink-900/20 bg-paper-100 px-4 py-3">
            <div className="pr-3">
              <p className="text-[11.5px] font-medium text-ink-500">Earned so far</p>
              <p className="mt-1 font-display text-[17px] leading-none font-extrabold tabular-nums text-ink-900">
                {coins.earned}
              </p>
            </div>
            <div className="pl-4">
              <p className="text-[11.5px] font-medium text-ink-500">Redeemed</p>
              <p className="mt-1 font-display text-[17px] leading-none font-extrabold tabular-nums text-ink-900">
                {coins.redeemed}
              </p>
            </div>
          </div>

          {/* Where a payment's draw is handed over, again: the receipt shows
              one card and this is the collection, so a card nobody opened is
              still reachable after the receipt is closed. */}
          <Link
            to="/scratch-cards"
            onClick={onClose}
            className="mt-3 flex items-center gap-3 rounded-[12px] border-[1.5px] border-ink-900/20 bg-paper-100 px-4 py-3 transition hover:border-ink-900/45"
          >
            <IconSpark size={16} className="shrink-0 text-pending-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink-900">
                Scratch cards
              </span>
              <span className="mt-0.5 block text-[11.5px] text-ink-500">
                Every card you have won, under its cover or opened
              </span>
            </span>
            <IconChevronRight size={16} className="shrink-0 text-ink-400" />
          </Link>

          {/* What earned them. Short by design: five rows, no running totals. */}
          {coins.awards.length > 0 ? (
            <div className="mt-4">
              <p className="mb-1.5 text-[12px] font-semibold text-ink-500">Recent rewards</p>
              <ul className="text-[12.5px]">
                {coins.awards.map((award) => (
                  <li
                    key={`${award.at}-${award.reason}-${award.coins}`}
                    className="flex items-center justify-between gap-3 border-t border-ink-200 py-2.5 first:border-t-0"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-ink-600">
                      <Coin size={18} />
                      <span className="truncate">{award.label}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="font-semibold text-ink-900 tabular-nums">
                        +{award.coins}
                      </span>
                      <span className="text-[11.5px] text-ink-400 tabular-nums">
                        {formatDateTime(award.at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-[12px] border border-dashed border-ink-300 px-4 py-4 text-center text-[12.5px] text-ink-500">
              Pay someone and this fills up — every payment draws 1 to 50 coins.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
