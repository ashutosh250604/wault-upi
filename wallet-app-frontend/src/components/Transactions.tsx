import type { WalletTransaction } from "../types";
import { cx } from "../lib/cx";
import { formatCurrency, formatDateTime, formatTime } from "../lib/format";
import {
  buildReceiptText,
  classifyTransaction,
  groupTransactionsByDay,
  transactionTypeLabel,
  type ClassifiedTransaction,
} from "../lib/transactions";
import { shareText } from "../lib/clipboard";
import { useToast } from "../hooks/toast";
import { Badge } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { CopyButton } from "./ui/CopyButton";
import { DetailRow } from "./ui/DetailRow";
import {
  IconNote,
  IconReceipt,
  IconReceived,
  IconSent,
  IconShare,
  IconSpark,
  IconWallet,
} from "./ui/Icons";
import { Sheet } from "./ui/Sheet";
import { EmptyState, TransactionSkeleton } from "./ui/States";

function DirectionIcon({ direction, type }: { direction: "in" | "out"; type: string }) {
  const isTopUp = type === "topup";
  const isCashback = type === "cashback";
  return (
    <span
      className={cx(
        "flex size-10 shrink-0 items-center justify-center rounded-full",
        isCashback
          ? "bg-amber-50 text-amber-600"
          : isTopUp
            ? "bg-brand-50 text-brand-600"
            : direction === "in"
              ? "bg-emerald-50 text-emerald-600"
              : "bg-slate-100 text-slate-500",
      )}
    >
      {isCashback ? (
        <IconSpark size={18} />
      ) : isTopUp ? (
        <IconWallet size={18} />
      ) : direction === "in" ? (
        <IconReceived size={18} />
      ) : (
        <IconSent size={18} />
      )}
    </span>
  );
}

export function TransactionRow({
  item,
  onClick,
}: {
  item: ClassifiedTransaction;
  onClick?: () => void;
}) {
  const { transaction, direction, title, subtitle, signedAmount } = item;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition",
        "hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        "active:bg-slate-100",
      )}
    >
      <DirectionIcon direction={direction} type={transaction.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-slate-900">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-slate-500">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={cx(
            "block text-[14.5px] font-bold tabular-nums",
            direction === "in" ? "text-emerald-600" : "text-slate-900",
          )}
        >
          {signedAmount}
        </span>
        <span className="mt-0.5 block text-[11.5px] text-slate-400">
          {formatTime(transaction.timestamp)}
        </span>
      </span>
    </button>
  );
}

export interface TransactionListProps {
  transactions: WalletTransaction[] | null;
  userId: number;
  onSelect?: (transaction: WalletTransaction) => void;
  /** Cap the number of rows (used by the home screen preview). */
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export function TransactionList({
  transactions,
  userId,
  onSelect,
  limit,
  emptyTitle = "No transactions yet",
  emptyDescription = "Top up your wallet or pay someone to see it here.",
  emptyAction,
}: TransactionListProps) {
  if (transactions === null) return <TransactionSkeleton />;

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={<IconReceipt size={22} />}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const days = groupTransactionsByDay(transactions, userId);
  let rendered = 0;

  return (
    <div className="space-y-1">
      {days.map((day) => {
        if (limit !== undefined && rendered >= limit) return null;
        const items =
          limit === undefined ? day.items : day.items.slice(0, limit - rendered);
        rendered += items.length;
        // Only summarise a day when the extra maths earns its place.
        const shownNet =
          items.length > 1
            ? items.reduce(
                (total, item) =>
                  total +
                  (item.direction === "in" ? item.transaction.amount : -item.transaction.amount),
                0,
              )
            : 0;
        return (
          <div key={day.key}>
            <div className="flex items-center justify-between px-2 pt-4 pb-1">
              <h3 className="text-[11.5px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                {day.label}
              </h3>
              {shownNet !== 0 ? (
                <span
                  className={cx(
                    "text-[11.5px] font-semibold tabular-nums",
                    shownNet > 0 ? "text-emerald-600" : "text-slate-500",
                  )}
                >
                  {shownNet > 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(shownNet))}
                </span>
              ) : null}
            </div>
            {items.map((item) => (
              <TransactionRow
                key={item.transaction.id}
                item={item}
                onClick={onSelect ? () => onSelect(item.transaction) : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export interface TransactionDetailSheetProps {
  transaction: WalletTransaction | null;
  userId: number;
  open: boolean;
  onClose: () => void;
}

export function TransactionDetailSheet({
  transaction,
  userId,
  open,
  onClose,
}: TransactionDetailSheetProps) {
  const toast = useToast();

  if (!transaction) return null;
  const item = classifyTransaction(transaction, userId);
  const isCredit = item.direction === "in";
  const isCashback = transaction.type === "cashback";

  const onShare = async () => {
    const result = await shareText({
      title: "Wallet Pay receipt",
      text: buildReceiptText({
        headline: isCashback
          ? "Cashback credited"
          : isCredit
            ? "Money received"
            : "Payment successful",
        amount: transaction.amount,
        counterpartyName: item.counterpartyName,
        reference: transaction.reference,
        timestamp: formatDateTime(transaction.timestamp),
        note: transaction.note,
      }),
    });
    if (result === "copied") toast.success("Receipt copied to clipboard");
    if (result === "failed") toast.error("Couldn't share the receipt");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isCashback ? "Cashback credited" : isCredit ? "Money received" : "Payment details"}
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => void onShare()}
            leftIcon={<IconShare size={16} />}
          >
            Share receipt
          </Button>
          <Button fullWidth onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center pb-2 text-center">
        <DirectionIcon direction={item.direction} type={transaction.type} />
        <p
          className={cx(
            "mt-3 text-3xl font-bold tracking-tight tabular-nums",
            isCredit ? "text-emerald-600" : "text-slate-900",
          )}
        >
          {item.signedAmount}
        </p>
        <p className="mt-1 text-[13.5px] text-slate-500">{item.title}</p>
        <Badge
          tone={
            transaction.status === "success"
              ? "success"
              : transaction.status === "pending"
                ? "pending"
                : "failed"
          }
          className="mt-2"
        >
          {transaction.status === "success" ? "Successful" : transaction.status}
        </Badge>
      </div>

      <div className="mt-2">
        <DetailRow label="Reference">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {transaction.reference}
            <CopyButton
              value={transaction.reference}
              label="Copy reference number"
              size={14}
              onCopied={(ok) => ok && toast.success("Reference copied")}
            />
          </span>
        </DetailRow>
        <DetailRow label="Date">{formatDateTime(transaction.timestamp)}</DetailRow>
        <DetailRow label="Type">{transactionTypeLabel(transaction.type)}</DetailRow>
        {transaction.note ? (
          <DetailRow label="Note">
            <span className="inline-flex items-start justify-end gap-1">
              <IconNote size={14} className="mt-0.5 text-slate-400" />
              {transaction.note}
            </span>
          </DetailRow>
        ) : null}
      </div>
    </Sheet>
  );
}
