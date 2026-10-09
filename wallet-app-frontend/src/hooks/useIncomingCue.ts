import { useEffect, useRef } from "react";
import type { WalletTransaction } from "../types";
import { feedback } from "../lib/feedback";

/**
 * Announce money arriving on the current screen.
 *
 * Cutting a cue for "someone paid you" needs care: the ledger also gains rows
 * when *you* spend, when you top up, and when coins are redeemed into the
 * balance, and none of those should sound like being paid. This watches only for
 * a new row that is an incoming transfer from another wallet.
 *
 * The first ledger it sees is absorbed silently — otherwise opening the app
 * would chirp about a payment from last week. A cue therefore only ever plays
 * for money that arrived while this screen was open, which is the honest
 * definition of "you just got paid".
 *
 * Every row above the high-water mark is inspected, not just the newest one: a
 * reward never moves the ledger on its own (coins are an award log, not a
 * transaction), but a redemption is a credit row and can sort alongside the
 * payment that prompted it.
 */
export function useIncomingCue(
  transactions: WalletTransaction[] | null,
  userId: number | null | undefined,
): void {
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!transactions || transactions.length === 0 || userId == null) return;

    const highest = transactions.reduce(
      (max, row) => (row.id > max ? row.id : max),
      transactions[0].id,
    );
    const previous = seen.current;
    seen.current = highest;
    // Nothing new, or the very first ledger this screen has seen.
    if (previous === null || highest === previous) return;

    const arrived = transactions.some(
      (row) =>
        row.id > previous &&
        row.type === "transfer" &&
        row.status === "success" &&
        row.receiver === userId &&
        row.sender !== userId,
    );
    if (arrived) feedback.received();
  }, [transactions, userId]);
}
