/** Pure shaping helpers for the transaction list — no React, easy to unit test. */

import type { WalletTransaction } from "../types";
import { formatCurrency, formatDayLabel, dayKey } from "./format";

export interface ClassifiedTransaction {
  transaction: WalletTransaction;
  direction: "in" | "out";
  /** "To Meera Iyer" / "From Meera Iyer" / "Wallet top-up" */
  title: string;
  counterpartyName: string;
  /** "+₹400.00" / "−₹400.00" */
  signedAmount: string;
  /** Sub-line under the title: note when present, otherwise the reference. */
  subtitle: string;
}

export function classifyTransaction(
  transaction: WalletTransaction,
  userId: number,
): ClassifiedTransaction {
  const isTopUp = transaction.type === "topup";
  const direction: "in" | "out" =
    isTopUp || transaction.receiver === userId ? "in" : "out";

  const counterpartyName =
    direction === "out"
      ? (transaction.receiver_name ?? "Recipient")
      : isTopUp
        ? "Self top-up"
        : (transaction.sender_name ?? "Someone");

  const title = isTopUp
    ? "Wallet top-up"
    : direction === "out"
      ? `To ${counterpartyName}`
      : `From ${counterpartyName}`;

  const sign = direction === "in" ? "+" : "−";
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
  lines.push("", "Sent via PocketPay — a UPI-style demo wallet (not real UPI).");
  return lines.join("\n");
}
