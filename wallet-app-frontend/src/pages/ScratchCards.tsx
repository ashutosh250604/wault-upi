import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ScratchCard as ScratchCardModel } from "../types";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime } from "../lib/format";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { useToast } from "../hooks/toast";
import { AppBar, AppShell } from "../components/AppShell";
import { ScratchCard } from "../components/ScratchCard";
import { Button } from "../components/ui/Button";
import { Coin } from "../components/ui/Coin";
import { IconSpark } from "../components/ui/Icons";
import { EmptyState, ErrorState, SkeletonCard } from "../components/ui/States";

/**
 * The scratch card collection: every card a payment has won, newest first.
 *
 * The receipt hands over one card at a time — that is where a draw is won —
 * and this is where the cards live afterwards. An unscratched one is drawn
 * covered, exactly as it was handed over, and can be scratched here instead;
 * a scratched one keeps what it paid, so the screen reads as a history of what
 * paying has been worth rather than as a pile of unopened envelopes.
 *
 * The cards are payment draws only. The welcome bonus and an offer's payout are
 * credited and announced outright, with nothing under a cover to lift, so they
 * are told about in the inbox instead of being listed as cards nobody can open.
 */

/** "₹25 to Meera Iyer" — the payment behind a card, as one line. */
function paymentLine(card: ScratchCardModel): string {
  if (card.amount === null) return "A payment you made";
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
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<IconSpark size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />}
            iconTone="pending"
            title="No scratch cards yet"
            description="Every payment draws 1 to 50 coins and lands here as a card. Pay someone and the first one arrives."
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
              <p className="text-[12px] leading-relaxed text-pending-900">
                {waiting === 0
                  ? "Every card has been scratched. There is nothing left under a cover."
                  : `${waiting} ${waiting === 1 ? "card is" : "cards are"} still under the cover — scratch ${
                      waiting === 1 ? "it" : "them"
                    } here or open the receipt it came on.`}
              </p>
            </div>

            <p className="mt-4 text-[11.5px] font-semibold tracking-[0.06em] text-ink-400 uppercase">
              Newest first
            </p>

            <ul className="mt-2.5 space-y-4">
              {list.map((card) => (
                <li key={card.id}>
                  {card.scratched ? (
                    <div className="flex items-center gap-3 rounded-[12px] border-[1.5px] border-ink-900/20 bg-paper-100 px-4 py-3">
                      <Coin size={36} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-ink-900 tabular-nums">
                          {card.coins === null
                            ? "Coins added"
                            : `${card.coins} ${card.coins === 1 ? "coin" : "coins"} won`}
                        </p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-500">
                          {paymentLine(card)} · {formatDateTime(card.at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-credit-600">
                        Scratched
                      </span>
                    </div>
                  ) : (
                    // The caption sits at the card's own width, so the two read
                    // as one object rather than a label beside a box.
                    <div className="mx-auto w-full max-w-[17rem] space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 truncate text-[12.5px] font-semibold text-ink-700">
                          {paymentLine(card)}
                        </p>
                        <span className="shrink-0 text-[11px] text-ink-400 tabular-nums">
                          {formatDateTime(card.at)}
                        </span>
                      </div>
                      <ScratchCard
                        coins={card.coins ?? 0}
                        revealed={false}
                        onRevealed={() => void openCard(card)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
