import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ScratchCard as ScratchCardModel } from "../types";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime, formatDayLabel } from "../lib/format";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { primeCoins } from "../hooks/useCoins";
import { useToast } from "../hooks/toast";
import { AppBar, AppShell } from "../components/AppShell";
import { ScratchCard } from "../components/ScratchCard";
import { Button } from "../components/ui/Button";
import { IconSpark } from "../components/ui/Icons";
import { EmptyState, ErrorState, SkeletonCard } from "../components/ui/States";

/**
 * The scratch card collection: every card the wallet has won, newest first, two
 * to a row.
 *
 * A card is handed over covered and stays here afterwards, so the screen reads
 * as a record of what the wallet has given back rather than as a pile of
 * unopened envelopes. A covered card is scratchable right here; a card that has
 * been scratched shows what it paid.
 *
 * **This screen is where coins are collected.** A draw counts towards the
 * balance when its card is scratched and not before — the amount is decided
 * when the card is won, stored on the server, and absent from every payload
 * until this screen claims it. So the reveal follows the server's answer rather
 * than racing it: the card holds its cover while the claim is in flight, and
 * what appears underneath is the number the account was actually paid.
 *
 * Every coin award is here, not only the payment draws: an offer's payout and
 * the welcome bonus arrive as cards too, and are claimed the same way. Those
 * have no payment behind them and are named by what paid them instead.
 */

/** "₹25 to Meera Iyer" for a payment's card, the reason's own line for the rest. */
function cardLine(card: ScratchCardModel): string {
  if (card.reason !== "payment" || card.amount === null) return card.caption;
  const amount = formatCurrency(card.amount);
  return card.paid_to ? `${amount} to ${card.paid_to}` : `${amount} paid`;
}

export default function ScratchCardsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [cards, setCards] = useState<ScratchCardModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry state so the effect re-runs without a page reload.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const collection = await api.scratchCards(controller.signal);
        setCards(collection.cards);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setCards(null);
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  /**
   * Claim a card: scratch it, and let the account pay it.
   *
   * Nothing is revealed until this answers, because the amount does not exist on
   * this device until then — the card is where the prize lives. The response
   * carries the coins, the card and the fresh coin snapshot, so the reveal, the
   * header chip and this list all move together. Nothing is written locally
   * first: an optimistic mark would show a prize the server had not paid, and a
   * refusal would leave a card looking opened with no coins behind it.
   *
   * Returns whether the claim landed, which is what the card under the finger
   * uses to decide between showing the coins and staying scratchable.
   */
  const claimCard = async (card: ScratchCardModel): Promise<boolean> => {
    try {
      const result = await api.scratchCard(card.id);
      setCards((current) =>
        (current ?? []).map((item) => (item.id === card.id ? result.card : item)),
      );
      // The chip on the home screen reads this the moment it mounts: a claim
      // mints no transaction, so its own reload key would not have moved.
      primeCoins(result.coins);
      feedback.reward();
      return true;
    } catch (err) {
      feedback.warn();
      toast.error(errorMessage(err));
      return false;
    }
  };

  const list = cards ?? [];
  const waiting = list.filter((card) => !card.scratched).length;

  return (
    <AppShell header={<AppBar title="Scratch cards" showBack />}>
      <div className="px-5 py-5">
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              setError(null);
              setCards(null);
              setReloadKey((key) => key + 1);
            }}
          />
        ) : cards === null ? (
          <div className="grid grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<IconSpark size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />}
            iconTone="pending"
            title="No scratch cards yet"
            description="Every payment draws 1 to 50 coins, every offer pays in coins, and each payout arrives here as a card. Scratch one and its coins land in your balance."
            action={
              <Button size="lg" onClick={() => navigate("/scan")}>
                Make a payment
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex items-start gap-2.5 rounded-[10px] border border-dashed border-pending-300 bg-pending-50 px-3.5 py-3">
              <IconSpark size={16} className="mt-0.5 shrink-0 text-pending-600" />
              <p className="text-[12px] leading-relaxed text-pending-800">
                {waiting === 0
                  ? "Every card has been scratched. There is nothing left under a cover."
                  : `${waiting} ${waiting === 1 ? "card is" : "cards are"} still under the cover — scratch ${
                      waiting === 1 ? "it" : "them"
                    } here to reveal ${waiting === 1 ? "its reward" : "their rewards"}. The coins are counted when you do.`}
              </p>
            </div>

            <p className="mt-4 text-[11.5px] font-semibold tracking-[0.06em] text-ink-400 uppercase">
              Newest first
            </p>

            {/* Two to a row: a card is a small object, and a list of them reads
                faster side by side than one per screen-width. */}
            <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-6">
              {list.map((card) => {
                const line = cardLine(card);
                const at = formatDateTime(card.at);
                return (
                  <li key={card.id} className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cx(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] uppercase",
                          card.scratched
                            ? "bg-credit-50 text-credit-700"
                            : "bg-pending-50 text-pending-800",
                        )}
                      >
                        {card.scratched ? "Scratched" : "Waiting"}
                      </span>
                      <span className="truncate text-[10.5px] text-ink-400" title={at}>
                        {formatDayLabel(card.at)}
                      </span>
                    </div>

                    <div className="mt-1.5">
                      <ScratchCard
                        compact
                        coins={card.coins}
                        revealed={card.scratched}
                        onClaim={() => claimCard(card)}
                      />
                    </div>

                    <p
                      className="mt-1.5 truncate text-[11.5px] font-semibold text-ink-700"
                      title={line}
                    >
                      {line}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
