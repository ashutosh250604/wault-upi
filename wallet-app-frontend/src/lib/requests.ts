/** Display helpers for money requests, shared by the screen and the home banner. */

import type { MoneyRequest, RequestStatus } from "../types";

export type RequestsStatus = "loading" | "ready" | "error";

/** "Meera Iyer asked you for ₹250" / "You asked Rohan Verma for ₹250". */
export function requestHeadline(request: MoneyRequest): string {
  const who = request.counterparty.name ?? "Someone";
  return request.direction === "incoming"
    ? `${who} asked you for money`
    : `You asked ${who} for money`;
}

/** The line under the amount in a request row. */
export function requestSubtitle(request: MoneyRequest): string {
  if (request.status === "paid" && request.transfer_reference) {
    return `Paid · ${request.transfer_reference}`;
  }
  if (request.status === "declined") return "Declined";
  if (request.status === "cancelled") return "Cancelled";
  return request.direction === "incoming" ? "Waiting for your answer" : "Waiting for them";
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  declined: "Declined",
  cancelled: "Cancelled",
};

/** Only incoming, still-open asks need an answer from this user. */
export function incomingOpen(requests: MoneyRequest[] | null): MoneyRequest[] {
  return (requests ?? []).filter(
    (item) => item.direction === "incoming" && item.status === "pending",
  );
}

export function outgoingOpen(requests: MoneyRequest[] | null): MoneyRequest[] {
  return (requests ?? []).filter(
    (item) => item.direction === "outgoing" && item.status === "pending",
  );
}

export function resolved(requests: MoneyRequest[] | null): MoneyRequest[] {
  return (requests ?? []).filter((item) => item.status !== "pending");
}
