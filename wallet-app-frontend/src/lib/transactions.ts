/** Pure shaping helpers for the transaction list — no React, easy to unit test. */

import type { WalletTransaction } from "../types";
import { formatCurrency, formatDayLabel, dayKey } from "./format";

export interface ClassifiedTransaction {
  transaction: WalletTransaction;
  direction: "in" | "out";
  /** "To Meera Iyer" / "From Meera Iyer" / "Wallet top-up" */
  title: string;
  counterpartyName: string;
  /** "+₹400.00" for money in, "₹400.00" for money out — no minus sign. */
  signedAmount: string;
  /** Sub-line under the title: note when present, otherwise the reference. */
  subtitle: string;
}

export function classifyTransaction(
  transaction: WalletTransaction,
  userId: number,
): ClassifiedTransaction {
  const isTopUp = transaction.type === "topup";
  // A cashback or a coin redemption has no counterparty at all: the money comes
  // from WAULT's own rewards engine, so it is credited rather than received
  // "from" anyone.
  const isCashback = transaction.type === "cashback";
  const isCoins = transaction.type === "coins";
  const isReward = isCashback || isCoins;
  const direction: "in" | "out" =
    isTopUp || isReward || transaction.receiver === userId ? "in" : "out";

  const counterpartyName =
    direction === "out"
      ? (transaction.receiver_name ?? "Recipient")
      : isTopUp
        ? "Self top-up"
        : isCoins
          ? "WAULT coins"
          : isCashback
            ? "WAULT rewards"
            : (transaction.sender_name ?? "Someone");

  const title = isTopUp
    ? "Wallet top-up"
    : isCoins
      ? "Coins redeemed"
      : isCashback
        ? "Cashback credited"
        : direction === "out"
          ? `To ${counterpartyName}`
          : `From ${counterpartyName}`;

  // Only credits carry a sign. A payment out is already marked by the arrow
  // and the ink tone, and a leading minus reads like a correction on a receipt.
  const sign = direction === "in" ? "+" : "";
  const subtitle =
    transaction.note?.trim() ||
    (isTopUp ? "Added from linked source" : transaction.reference);

  return {
    transaction,
    direction,
    title,
    counterpartyName,
    signedAmount: `${sign}${formatCurrency(transaction.amount)}`,
    subtitle,
  };
}

export interface TransactionDay {
  key: string;
  label: string;
  /** Net movement for the day, in rupees: credits minus debits. */
  net: number;
  items: ClassifiedTransaction[];
}

/** Newest first, grouped into day buckets for the history screen. */
export function groupTransactionsByDay(
  transactions: WalletTransaction[],
  userId: number,
): TransactionDay[] {
  const days = new Map<string, TransactionDay>();

  for (const transaction of transactions) {
    const key = dayKey(transaction.timestamp);
    let day = days.get(key);
    if (!day) {
      day = { key, label: formatDayLabel(transaction.timestamp), net: 0, items: [] };
      days.set(key, day);
    }
    const item = classifyTransaction(transaction, userId);
    day.net += item.direction === "in" ? transaction.amount : -transaction.amount;
    day.items.push(item);
  }

  return [...days.values()];
}

/** "Wallet top-up" / "Cashback" / "UPI-style transfer" — the Type row on a receipt. */
export function transactionTypeLabel(type: WalletTransaction["type"]): string {
  if (type === "topup") return "Wallet top-up";
  if (type === "cashback") return "Cashback credit";
  if (type === "coins") return "Coin reward";
  return "UPI-style transfer";
}

export interface ReceiptTextInput {
  headline: string;
  amount: number;
  counterpartyName: string;
  reference: string;
  timestamp: string;
  note?: string | null;
}

/** Plain-text receipt for the Web Share API / clipboard fallback. */
export function buildReceiptText(input: ReceiptTextInput): string {
  const lines = [
    input.headline,
    `${formatCurrency(input.amount)} · ${input.counterpartyName}`,
    `Reference: ${input.reference}`,
    `Date: ${input.timestamp}`,
  ];
  if (input.note) lines.push(`Note: ${input.note}`);
  lines.push("", "Paid with WAULT — UPI-style instant payments.");
  return lines.join("\n");
}
