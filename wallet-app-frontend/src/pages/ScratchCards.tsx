import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ScratchCard as ScratchCardModel } from "../types";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime, formatDayLabel } from "../lib/format";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
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
 * been scratched shows what it paid. Nothing is ever opened for the user: the
 * coins are in the balance the moment they are won, and the cover is theirs to
 * lift whenever they want to.
 *
 * Every coin award is here, not only the payment draws: an offer's payout and
 * the welcome bonus are the same kind of thing — coins that landed the moment
 * they were earned — so they arrive as cards too. Those have no payment behind
 * them and are named by what paid them instead.
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
   * Open a card: lift the cover, then write down that it was lifted.
   *
   * The card is marked here before the request comes back, so the reveal never
   * waits on the network — the coins are already in the balance, and this call
   * only decides whether the card is still covered tomorrow. A failure is said
   * out loud rather than swallowed: the card will read as unscratched the next
   * time this screen is opened, which is the honest outcome.
   */
  const openCard = async (card: ScratchCardModel) => {
    feedback.coins();
    setCards((current) =>
      (current ?? []).map((item) =>
        item.id === card.id
          ? { ...item, scratched: true, scratched_at: new Date().toISOString() }
          : item,
      ),
    );
    try {
      await api.scratchCard(card.id);
    } catch (err) {
      feedback.warn();
      toast.error(errorMessage(err));
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
            description="Every payment draws 1 to 50 coins, every offer pays in coins, and each payout lands here as a card. Earn one and it arrives."
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
                    } here whenever you like. The coins are already yours.`}
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
                        coins={card.coins ?? 0}
                        revealed={card.scratched}
                        onRevealed={() => void openCard(card)}
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
