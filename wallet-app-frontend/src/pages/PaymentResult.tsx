import { Link, Navigate, useLocation } from "react-router-dom";
import { formatCurrency, formatDateTime } from "../lib/format";
import { buildReceiptText } from "../lib/transactions";
import { parseReceipt } from "../lib/routing";
import { shareText } from "../lib/clipboard";
import { useMemo } from "react";
import { useToast } from "../hooks/toast";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { IconCheck, IconShare } from "../components/ui/Icons";

export default function PaymentResultPage() {
  const location = useLocation();
  const toast = useToast();
  const receipt = useMemo(() => parseReceipt(location.state), [location.state]);

  if (!receipt) return <Navigate to="/home" replace />;

  const isTopUp = receipt.kind === "topup";
  const headline = isTopUp ? "Money added" : "Payment successful";
  const shareBody = buildReceiptText({
    headline,
    amount: receipt.amount,
    counterpartyName: isTopUp ? "your wallet" : receipt.counterpartyName,
    reference: receipt.reference,
    timestamp: formatDateTime(receipt.timestamp),
    note: receipt.note,
  });

  const onShare = async () => {
    const result = await shareText({ title: "PocketPay receipt", text: shareBody });
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
          Saved to your transaction history. This receipt is demo data — no real money
          moved.
        </p>
      </div>
    </AppShell>
  );
}
