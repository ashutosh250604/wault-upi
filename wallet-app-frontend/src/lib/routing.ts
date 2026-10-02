/**
 * Router state is `unknown` at runtime (a refresh or a hand-typed URL can put
 * anything there), so these guards convert it into the shapes the payment
 * screens expect — or reject it and send the user somewhere sane.
 */

import type { CreditedReward, PaymentIntent, Receipt } from "../types";

/**
 * Cashback rows carried on a receipt.
 *
 * This guard exists because the parser *rebuilds* the object rather than
 * trusting it, which means any field it forgets is silently dropped — a reward
 * credited by the server can otherwise never reach the celebration on screen.
 */
function parseCreditedRewards(raw: unknown): CreditedReward[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const items = raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.amount !== "number") return [];
    return [
      {
        code: typeof item.code === "string" ? item.code : "reward",
        title: item.title,
        amount: item.amount,
      },
    ];
  });

  return items.length > 0 ? items : undefined;
}

export function parsePaymentIntent(state: unknown): PaymentIntent | null {
  if (typeof state !== "object" || state === null) return null;
  const candidate = state as Record<string, unknown>;

  if (candidate.mode === "topup") return { mode: "topup" };

  if (candidate.mode === "transfer" && typeof candidate.receiverId === "number") {
    return {
      mode: "transfer",
      receiverId: candidate.receiverId,
      receiverName:
        typeof candidate.receiverName === "string" ? candidate.receiverName : null,
      receiverVpa: typeof candidate.receiverVpa === "string" ? candidate.receiverVpa : null,
      suggestedAmount:
        typeof candidate.suggestedAmount === "number" && candidate.suggestedAmount > 0
          ? candidate.suggestedAmount
          : undefined,
      note: typeof candidate.note === "string" ? candidate.note : undefined,
    };
  }

  return null;
}

export function parseReceipt(state: unknown): Receipt | null {
  if (typeof state !== "object" || state === null) return null;
  const candidate = (state as Record<string, unknown>).receipt;
  if (typeof candidate !== "object" || candidate === null) return null;
  const receipt = candidate as Record<string, unknown>;

  const kind = receipt.kind === "topup" ? "topup" : "transfer";
  if (typeof receipt.amount !== "number" || typeof receipt.reference !== "string") {
    return null;
  }

  return {
    kind,
    amount: receipt.amount,
    reference: receipt.reference,
    counterpartyName:
      typeof receipt.counterpartyName === "string" ? receipt.counterpartyName : "Recipient",
    counterpartyVpa:
      typeof receipt.counterpartyVpa === "string" ? receipt.counterpartyVpa : null,
    note: typeof receipt.note === "string" ? receipt.note : null,
    timestamp:
      typeof receipt.timestamp === "string" ? receipt.timestamp : new Date().toISOString(),
    cashback: parseCreditedRewards(receipt.cashback),
  };
}
