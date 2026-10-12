import { Link, Navigate, useLocation } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { cx } from "../lib/cx";
import { formatCurrency, formatDateTime } from "../lib/format";
import { parseReceipt } from "../lib/routing";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { Coin } from "../components/ui/Coin";
import { TILE_GLYPH } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import { IconCheck, IconChevronRight } from "../components/ui/Icons";

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

  if (!receipt) return <Navigate to="/home" replace />;

  const isTopUp = receipt.kind === "topup";
  const headline = isTopUp ? "Money added" : "Payment successful";

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

        {/* The card, as the thing to do next — and not as a paragraph about
            the thing to do next.

            This used to be a two-line notice under a secondary "Scratch Card"
            button: the notice said a card was waiting, the button said the same
            in two words, and the note underneath explained coin economics. The
            user was told one thing three times and handed the action as the
            quieter of two buttons.

            Now it is one object that is obviously tappable — the app's slip: an
            inked edge, a hard print shadow, the coin it pays out, and a chevron
            saying where it goes. It carries no amount, because the amount does
            not exist on this device until the card is scratched. */}
        {receipt.scratchCardWaiting ? (
          <Link
            to="/scratch-cards"
            className={cx(
              "mt-6 flex items-center gap-3 rounded-[14px] border-[1.5px] border-ink-900 bg-seal-50 py-3 pr-3.5 pl-3",
              "shadow-[3px_3px_0_0_rgba(25,25,22,0.85)] transition",
              "hover:bg-seal-100 active:translate-y-px active:shadow-[1px_1px_0_0_rgba(25,25,22,0.85)]",
              "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
            )}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[11px] border-[1.5px] border-ink-900 bg-paper-25">
              <Coin size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-ink-900">
                Scratch card ready
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-600">
                Tap to reveal your coins
              </span>
            </span>
            <IconChevronRight size={18} className="shrink-0 text-ink-600" />
          </Link>
        ) : null}

        <div className={cx(receipt.scratchCardWaiting ? "mt-3" : "mt-6")}>
          <Link to="/home" replace className="contents">
            <Button
              // With a card waiting the card is the action and this is the way
              // out; with nothing to collect it is the only thing left to do.
              variant={receipt.scratchCardWaiting ? "secondary" : "primary"}
              size="lg"
              fullWidth
            >
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

        <p className="mt-7 text-center text-[11.5px] leading-relaxed text-ink-400">
          Saved to your transactions.
        </p>
      </div>

    </AppShell>
  );
}
