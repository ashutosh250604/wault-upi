/**
 * Client-side validation mirroring the server's rules, so users get feedback
 * before a round trip. The server always re-validates — this is UX, not trust.
 */

import { formatCurrency } from "./format";

export const MOBILE_RE = /^[6-9]\d{9}$/;
export const OTP_RE = /^\d{6}$/;
export const PIN_RE = /^\d{4}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const VPA_RE = /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]{2,}$/i;

/** Mirrors MAX_TOPUP_RUPEES in the backend config. */
export const MAX_TOPUP_RUPEES = 100_000;
/** Someone keying ₹99,99,999 should be stopped client-side too. */
export const MAX_TRANSFER_RUPEES = 100_000;

export function mobileError(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "Enter your mobile number";
  if (digits.length !== 10) return "Mobile number must be 10 digits";
  if (!MOBILE_RE.test(digits)) return "Indian mobile numbers start with 6-9";
  return null;
}

export function pinError(value: string): string | null {
  if (!value) return "Enter your 4-digit PIN";
  if (!PIN_RE.test(value)) return "PIN is exactly 4 digits";
  return null;
}

export function nameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter your full name";
  if (name.length < 3) return "That looks too short";
  if (name.length > 120) return "Keep it under 120 characters";
  return null;
}

/** Email is optional, but wrong emails are rejected. */
export function emailError(value: string): string | null {
  const email = value.trim();
  if (!email) return null;
  if (!EMAIL_RE.test(email)) return "Enter a valid email like you@example.com";
  return null;
}

export function vpaError(value: string): string | null {
  const vpa = value.trim().toLowerCase();
  if (!vpa) return "Enter a UPI ID";
  if (!vpa.includes("@")) return "UPI IDs look like name@bank";
  if (!VPA_RE.test(vpa)) return "That doesn't look like a valid UPI ID";
  return null;
}

/** The bare 10-digit mobile in a typed value, or null when there isn't one. */
export function normaliseMobile(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits || null;
}

/**
 * Payment entry points accept either identifier, so they share one check:
 * anything with an "@" is a UPI ID, everything else must be a mobile number.
 */
export function payeeIdentifierError(value: string): string | null {
  const text = value.trim();
  if (!text) return "Enter a mobile number or UPI ID";
  if (text.includes("@")) return vpaError(text);

  const local = normaliseMobile(text);
  if (!local || local.length !== 10) {
    return "Enter a 10-digit mobile number, or a UPI ID like name@okwault";
  }
  if (!MOBILE_RE.test(local)) return "Indian mobile numbers start with 6-9";
  return null;
}

/** Strip everything a numeric keypad shouldn't produce and cap at 2 decimals. */
export function sanitizeAmountInput(raw: string): string {
  // A paste could contain "₹1,234.5678" — keep the digits and one separator.
  const cleaned = raw.replace(/[^\d.]/g, "").replace(/\.(?=.*\.)/g, "");
  const [whole = "", decimals] = cleaned.split(".");
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "").slice(0, 9);
  if (decimals === undefined) return trimmedWhole;
  return `${trimmedWhole}.${decimals.slice(0, 2)}`;
}

/** "150.5" -> 150.5, "150." -> 150, "" -> 0 */
export function toRupees(raw: string): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

export interface AmountRules {
  /** Server-side ceiling for this operation, in rupees. */
  max?: number;
  /** Sender's balance, so we can pre-empt an "Insufficient funds" round trip. */
  available?: number;
  /**
   * What's left of today's spending cap. Reported separately from the balance
   * because "you don't have the money" and "you can't send that much today"
   * are different problems with different fixes.
   */
  dailyRemaining?: number;
}

/**
 * Returns a human-readable problem with the amount, or null when it's payable.
 * `raw` is the keypad string, so "0." and "" are treated as "nothing yet".
 */
export function amountError(raw: string, rules: AmountRules = {}): string | null {
  if (!raw || raw === ".") return "Enter an amount";
  const value = toRupees(raw);
  if (value <= 0) return "Amount must be more than ₹0";
  if (/\.\d{3,}$/.test(raw)) return "Use at most 2 decimal places (paise)";
  if (rules.max !== undefined && value > rules.max) {
    return `Maximum is ${formatCurrency(rules.max)} per transaction`;
  }
  if (rules.available !== undefined && value > rules.available) {
    return `That's more than your balance of ${formatCurrency(rules.available)}`;
  }
  if (rules.dailyRemaining !== undefined && value > rules.dailyRemaining) {
    return `That's over today's remaining limit of ${formatCurrency(rules.dailyRemaining)}`;
  }
  return null;
}

/** Fallback copy when the server sends an error body we can't read. */
export function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "That request wasn't accepted. Check the details and try again.";
    case 401:
      return "Your session expired. Please sign in again.";
    case 403:
      return "You don't have access to that.";
    case 404:
      return "We couldn't find that.";
    case 429:
      return "Too many attempts. Please wait a moment.";
    case 500:
    case 502:
    case 503:
      return "The server had a problem. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
