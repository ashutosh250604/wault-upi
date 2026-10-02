import { Link, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { formatCurrency, formatDateTime } from "../lib/format";
import { buildReceiptText } from "../lib/transactions";
import { parseReceipt } from "../lib/routing";
import { shareText } from "../lib/clipboard";
import { useMemo } from "react";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { IconCheck, IconShare, IconSpark } from "../components/ui/Icons";

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
  // Cashback that this very payment unlocked, credited in the same commit.
  const cashbackTotal = (receipt.cashback ?? []).reduce((sum, item) => sum + item.amount, 0);
  const shareBody = buildReceiptText({
    headline,
    amount: receipt.amount,
    counterpartyName: isTopUp ? "your wallet" : receipt.counterpartyName,
    reference: receipt.reference,
    timestamp: formatDateTime(receipt.timestamp),
    note: receipt.note,
  });

  const onShare = async () => {
    const result = await shareText({ title: "Wallet Pay receipt", text: shareBody });
    if (result === "copied") toast.success("Receipt copied to clipboard");
    if (result === "failed") toast.error("Couldn't share the receipt");
  };

  return (
    <AppShell>
      <div className="flex flex-col items-center px-5 pt-10 pb-8">
        <span className="relative flex size-20 items-center justify-center">
          <span className="absolute inset-0 animate-pop rounded-full bg-emerald-100" />
          <span className="absolute inset-2 animate-pop rounded-full bg-emerald-500/15" />
          <span
            className="relative flex size-14 animate-pop items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
            style={{ animationDelay: "60ms" }}
          >
            <IconCheck size={30} />
          </span>
        </span>

        <h1 className="mt-6 text-[20px] font-bold tracking-tight text-slate-900">
          {headline}
        </h1>
        <p className="mt-2 text-[2rem] leading-none font-bold tracking-tight tabular-nums text-slate-900">
          {formatCurrency(receipt.amount)}
        </p>
        <p className="mt-2 text-[13.5px] text-slate-500">
          {isTopUp ? "Added to your wallet" : `Paid to ${receipt.counterpartyName}`}
        </p>

        {receipt.cashback && receipt.cashback.length > 0 ? (
          <div className="mt-5 flex w-full items-start gap-3 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 px-4 py-3 ring-1 ring-amber-200">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
              <IconSpark size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-amber-900">
                {formatCurrency(cashbackTotal)} cashback credited
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-amber-900/70">
                {receipt.cashback.map((item) => item.title).join(" · ")} — already in your
                balance and your history, not a pending reward.
              </p>
            </div>
          </div>
        ) : null}

        <Card className="mt-7 w-full">
          <DetailRow label="Reference">
            <span className="inline-flex items-center gap-1 tabular-nums">
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
              <span className="inline-flex items-center gap-1 tabular-nums">
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
            <span className="font-semibold text-emerald-600">Successful</span>
          </DetailRow>
        </Card>

        <div className="mt-6 grid w-full grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void onShare()}
            leftIcon={<IconShare size={17} />}
          >
            Share
          </Button>
          <Link to="/home" replace className="contents">
            <Button size="lg" fullWidth>
              Done
            </Button>
          </Link>
        </div>

        <div className="mt-5 flex items-center gap-4 text-[12.5px] font-semibold">
          <Link
            to="/scan"
            className="text-brand-700 underline decoration-brand-300 underline-offset-2"
          >
            Make another payment
          </Link>
          <Link
            to="/history"
            className="text-slate-500 underline decoration-slate-300 underline-offset-2"
          >
            View history
          </Link>
        </div>

        <p className="mt-8 text-center text-[11.5px] leading-relaxed text-slate-400">
          Saved to your transaction history. Keep the reference number for your records.
        </p>
      </div>
    </AppShell>
  );
}
