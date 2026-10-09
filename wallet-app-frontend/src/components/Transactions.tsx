import type { WalletTransaction } from "../types";
import { cx } from "../lib/cx";
import { formatDateTime, formatTime } from "../lib/format";
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
import { Coin } from "./ui/Coin";
import { CopyButton } from "./ui/CopyButton";
import { DetailRow } from "./ui/DetailRow";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "./ui/IconTile";
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

/**
 * A small tile of press ink marking which way the money went.
 *
 * The same `IconTile` the inbox rows wear, at the same scale and with the same
 * tone vocabulary — so a payment reads the same on the sheet that announces it
 * and in the ledger that records it. It used to be a different size with a
 * different radius and a black tile for top-ups, which meant the two lists of
 * the same events looked like two different apps.
 */
function DirectionIcon({ direction, type }: { direction: "in" | "out"; type: string }) {
  const isTopUp = type === "topup";
  const isCoins = type === "coins";
  const isCashback = type === "cashback";
  const size = TILE_GLYPH.md;
  const strokeWidth = TILE_STROKE;

  // Cashback and coins are the same family — money WAULT itself handed over —
  // so they share the warm glyph and differ only in the mark beside it.
  if (isCoins) {
    return (
      <IconTile tone="pending" scale="md">
        <Coin size={size + 2} />
      </IconTile>
    );
  }
  if (isCashback) {
    return (
      <IconTile tone="pending" scale="md">
        <IconSpark size={size} strokeWidth={strokeWidth} />
      </IconTile>
    );
  }
  if (isTopUp) {
    return (
      <IconTile tone="ink" scale="md">
        <IconWallet size={size} strokeWidth={strokeWidth} />
      </IconTile>
    );
  }
  return (
    <IconTile tone={direction === "in" ? "credit" : "ink"} scale="md">
      {direction === "in" ? (
        <IconReceived size={size} strokeWidth={strokeWidth} />
      ) : (
        <IconSent size={size} strokeWidth={strokeWidth} />
      )}
    </IconTile>
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
        "flex w-full items-center gap-3 px-1 py-3.5 text-left transition",
        "hover:bg-paper-100 focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
        "active:bg-paper-200",
      )}
    >
      <DirectionIcon direction={direction} type={transaction.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-ink-900">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-ink-500">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={cx(
            "block text-[14.5px] font-bold tabular-nums",
            direction === "in" ? "text-credit-600" : "text-ink-900",
          )}
        >
          {signedAmount}
        </span>
        <span className="mt-0.5 block text-[11.5px] text-ink-400">
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
        icon={<IconReceipt size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const days = groupTransactionsByDay(transactions, userId);
  let rendered = 0;

  return (
    <div>
      {days.map((day) => {
        if (limit !== undefined && rendered >= limit) return null;
        const items =
          limit === undefined ? day.items : day.items.slice(0, limit - rendered);
        rendered += items.length;
        return (
          <div key={day.key}>
            {/* Just the day. A running total used to sit on the right of this
                rule — two figures from four different payments, added up and
                offered as if it were one of them. The rows below are the
                record; a sum of today is not. */}
            <div className="flex items-center justify-between border-b border-ink-200 pb-1.5">
              <h3 className="text-[12.5px] font-semibold text-ink-500">{day.label}</h3>
            </div>
            <div className="divide-y divide-ink-200/70 pt-1">
              {items.map((item) => (
                <TransactionRow
                  key={item.transaction.id}
                  item={item}
                  onClick={onSelect ? () => onSelect(item.transaction) : undefined}
                />
              ))}
            </div>
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
  const isReward = transaction.type === "cashback" || transaction.type === "coins";
  const headline = transaction.type === "coins" ? "Coins redeemed" : "Cashback credited";

  const onShare = async () => {
    const result = await shareText({
      title: "WAULT receipt",
      text: buildReceiptText({
        headline: isReward
          ? headline
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
      title={isReward ? headline : isCredit ? "Money received" : "Payment details"}
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
            "mt-3 font-display text-[2rem] leading-none font-extrabold tracking-[-0.02em] tabular-nums",
            isCredit ? "text-credit-600" : "text-ink-900",
          )}
        >
          {item.signedAmount}
        </p>
        <p className="mt-1.5 text-[13px] text-ink-500">{item.title}</p>
        <Badge
          tone={
            transaction.status === "success"
              ? "success"
              : transaction.status === "pending"
                ? "pending"
                : "failed"
          }
          className="mt-2.5"
        >
          {transaction.status === "success" ? "Successful" : transaction.status}
        </Badge>
      </div>

      <div className="mt-2">
        <DetailRow label="Reference">
          <span className="inline-flex items-center gap-1 font-mono text-[12px] tabular-nums">
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
              <IconNote size={14} className="mt-0.5 text-ink-400" />
              {transaction.note}
            </span>
          </DetailRow>
        ) : null}
      </div>
    </Sheet>
  );
}
