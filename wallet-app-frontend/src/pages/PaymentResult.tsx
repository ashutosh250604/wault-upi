import { Link, Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { formatCurrency, formatDateTime } from "../lib/format";
import { feedback } from "../lib/feedback";
import { parseReceipt } from "../lib/routing";
import { api } from "../lib/api";
import { useMemo } from "react";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { Coin } from "../components/ui/Coin";
import { TILE_GLYPH } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import { IconCheck, IconSpark } from "../components/ui/Icons";
import { ScratchSheet } from "../components/ScratchCard";

export default function PaymentResultPage() {
  const location = useLocation();
  const toast = useToast();
  const { refresh } = useAppSession();
  const receipt = useMemo(() => parseReceipt(location.state), [location.state]);

  // A payment just happened, so the cached balance and history are behind. One
  // silent refresh here means Home (and its people row) is already correct when
  // the user taps Done.
  useEffect(() => {
    void refresh({ silent: true });
  }, [refresh]);

  // Coins this payment paid: its own draw plus anything an offer it completed
  // paid alongside it — all written in the same commit as the payment.
  const coinsWon = receipt
    ? (receipt.coinsEarned ?? 0) +
      (receipt.cashback ?? []).reduce((sum, item) => sum + item.coins, 0)
    : 0;
  // The card is handed over covered, as soon as the receipt is up.
  const [scratching, setScratching] = useState(coinsWon > 0);

  // The celebration belongs to the moment the tick lands, and only to the first
  // render of a receipt — a re-render must not re-play it.
  const sounded = useRef(false);
  useEffect(() => {
    if (!receipt || sounded.current) return;
    sounded.current = true;
    // The coin drop belongs to the reveal when there is a card to scratch;
    // `ScratchSheet` plays it as the cover comes off.
    if (coinsWon === 0) feedback.coins();
  }, [receipt, coinsWon]);

  if (!receipt) return <Navigate to="/home" replace />;

  const isTopUp = receipt.kind === "topup";
  const headline = isTopUp ? "Money added" : "Payment successful";

  /**
   * Where these coins came from.
   *
   * A top-up completes an offer without drawing anything — only money sent to
   * someone else draws — so the draw is named only when there was one. It used
   * to be promised unconditionally, which had a ₹100 top-up claiming a draw as
   * well as the 25 coins its offer paid.
   */
  const offerTitles = (receipt.cashback ?? []).map((item) => item.title).join(", ");
  const rewardLine = offerTitles
    ? `${offerTitles} from your offers${
        (receipt.coinsEarned ?? 0) > 0 ? ", plus this payment's own draw" : ""
      }.`
    : "This payment's draw.";

  /**
   * The card has been opened on this screen, so say so.
   *
   * The reveal is local and instant; this only writes the fact down, which is
   * what stops the card from coming back covered on the collection screen. A
   * refusal is reported rather than swallowed — the user should know their
   * scratch was not remembered — but it never blocks the receipt.
   */
  const onCardScratched = () => {
    if (!receipt.cardId) return;
    void api
      .scratchCard(receipt.cardId)
      .catch(() => toast.error("Couldn't save that scratch card"));
  };

  return (
    <AppShell>
      <div className="px-5 pt-9 pb-8">
        {/* The receipt: the one place in the app that gets to make an entrance. */}
        <div className="relative rounded-[12px] border-[1.5px] border-ink-900/75 bg-paper-25 p-5 pt-6">
          <span
            aria-hidden="true"
            className="animate-stamp absolute -top-3.5 right-5 rounded-[6px] border-[3px] border-seal-500 bg-seal-50 px-2.5 py-1 font-display text-[14px] font-extrabold tracking-[0.16em] text-seal-600 uppercase"
          >
            {isTopUp ? "Added" : "Paid"}
          </span>

          {/* The tick is the answer to the question the user actually asked:
              did it go through? Everything else on this slip is detail. */}
          <div className="flex items-center gap-3">
            {/* The tick is the app's icon tile at its loudest: the same square
                a transaction row wears, filled with the ink that means money
                moved. A disc here and squares everywhere else is exactly the
                inconsistency this round is about. */}
            <IconTile tone="credit" scale="lg" solid className="animate-pop">
              <IconCheck size={TILE_GLYPH.lg + 1} strokeWidth={3} />
            </IconTile>
            <div className="min-w-0">
              <p className="font-display text-[17px] font-extrabold tracking-tight text-ink-900">
                {headline}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-500">
                {isTopUp ? "Added to your wallet" : `Paid to ${receipt.counterpartyName}`}
              </p>
            </div>
          </div>

          <p className="mt-4 font-display text-[2.4rem] leading-none font-extrabold tracking-[-0.035em] tabular-nums text-ink-900">
            <span className="text-ink-400">{isTopUp ? "+" : "−"}</span>
            {formatCurrency(receipt.amount)}
          </p>

          <div className="mt-5 border-t border-dashed border-ink-200">
            <DetailRow label="Reference">
              <span className="inline-flex items-center gap-1 font-mono text-[12px] tabular-nums">
                {receipt.reference}
                <CopyButton
                  value={receipt.reference}
                  label="Copy reference number"
                  size={14}
                  onCopied={(ok) => ok && toast.success("Reference copied")}
                />
              </span>
            </DetailRow>
            {receipt.counterpartyVpa ? (
              <DetailRow label={isTopUp ? "Credited to" : "UPI ID"}>
                <span className="inline-flex items-center gap-1 font-mono text-[12px] tabular-nums">
                  {receipt.counterpartyVpa}
                  <CopyButton
                    value={receipt.counterpartyVpa}
                    label="Copy UPI ID"
                    size={14}
                    onCopied={(ok) => ok && toast.success("UPI ID copied")}
                  />
                </span>
              </DetailRow>
            ) : null}
            <DetailRow label="Date">{formatDateTime(receipt.timestamp)}</DetailRow>
            {receipt.note ? <DetailRow label="Note">{receipt.note}</DetailRow> : null}
            <DetailRow label="Status">
              <span className="font-semibold text-credit-600">Successful</span>
            </DetailRow>
          </div>

          {/* Perforation marks, so the slip reads as something torn off. */}
          <span
            aria-hidden="true"
            className="absolute -bottom-[7px] left-4 h-3.5 w-3.5 rounded-full border-[1.5px] border-ink-900 bg-ink-900"
          />
          <span
            aria-hidden="true"
            className="absolute -bottom-[7px] right-4 h-3.5 w-3.5 rounded-full border-[1.5px] border-ink-900 bg-ink-900"
          />
        </div>

        {coinsWon > 0 ? (
          <div className="mt-6 flex items-start gap-3 rounded-[10px] border border-dashed border-seal-300 bg-seal-50 px-4 py-3">
            {/* The coin itself, not a sparkle: the reward line should be about
                the same object as the card the user just scratched. */}
            <Coin size={36} className="mt-0.5" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-seal-900">
                {coinsWon === 1 ? "1 coin earned" : `${coinsWon} coins earned`}
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-seal-800/80">
                {rewardLine}{" "}
                Coins sit in your coin balance, not your wallet — 10 redeem for ₹10.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid w-full grid-cols-2 gap-2">
          <Link to="/scratch-cards" className="contents">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leftIcon={<IconSpark size={17} />}
            >
              Scratch Card
            </Button>
          </Link>
          <Link to="/home" replace className="contents">
            <Button size="lg" fullWidth>
              Done
            </Button>
          </Link>
        </div>

        <div className="mt-5 flex items-center gap-4 text-[12.5px] font-semibold">
          <Link
            to="/scan"
            className="text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4"
          >
            Make another payment
          </Link>
          <Link
            to="/history"
            className="text-ink-500 underline decoration-ink-300 decoration-1 underline-offset-4"
          >
            View transactions
          </Link>
        </div>

        <p className="mt-8 text-center text-[11.5px] leading-relaxed text-ink-400">
          Saved to your transactions. Keep the reference number for your records.
        </p>
      </div>

      {/* Over the receipt, not instead of it: the coins are a footnote to the
          payment, and the payment is the thing that has to stay legible. */}
      <ScratchSheet
        open={scratching}
        coins={coinsWon}
        onClose={() => setScratching(false)}
        onScratched={onCardScratched}
      />
    </AppShell>
  );
}
