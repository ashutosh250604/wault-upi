/** Display helpers for payees, shared by the strip, the sheet and the list. */

import { formatMobile } from "./format";

export type PeopleStatus = "loading" | "ready" | "error";

interface NamedPayee {
  name: string | null;
  nickname?: string | null;
}

/** What to call someone: the owner's nickname wins over the registered name. */
export function personLabel(person: NamedPayee): string {
  return person.nickname?.trim() || person.name?.trim() || "Wallet Pay user";
}

/** The line under a person's name: their UPI ID, falling back to their number. */
export function personHandle(person: {
  vpa?: string | null;
  mobile?: string | null;
}): string {
  return person.vpa?.trim() || formatMobile(person.mobile) || "—";
}

/** "You paid" / "Paid you" / when they were last in touch. */
export function personCaption(person: {
  txn_count: number;
  last_direction: "in" | "out" | null;
  mobile?: string | null;
}): string {
  if (person.txn_count > 0) return person.last_direction === "out" ? "You paid" : "Paid you";
  return person.mobile ? formatMobile(person.mobile) : "Saved contact";
}
