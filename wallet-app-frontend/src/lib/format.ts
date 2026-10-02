/** Display formatting: Indian rupee amounts, dates and names. */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const plainAmount = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const groupedInteger = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

/** ₹5,000.00 */
export function formatCurrency(amount: number): string {
  return inr.format(Number.isFinite(amount) ? amount : 0);
}

/** ₹5,000 — for tight spaces like quick-amount chips. */
export function formatCurrencyShort(amount: number): string {
  return inrCompact.format(Number.isFinite(amount) ? amount : 0);
}

/** 5,000.00 */
export function formatAmount(amount: number): string {
  return plainAmount.format(Number.isFinite(amount) ? amount : 0);
}

/** 5,000 */
export function formatInteger(value: number): string {
  return groupedInteger.format(Number.isFinite(value) ? value : 0);
}

/**
 * Group the digits of an in-progress amount string ("1234.5" -> "1,234.5")
 * without reformatting the decimals the user is still typing.
 */
export function groupAmountInput(value: string): string {
  if (!value) return "";
  const [whole, ...rest] = value.split(".");
  const grouped = whole ? groupedInteger.format(Number(whole)) : "0";
  return rest.length ? `${grouped}.${rest[0]}` : grouped;
}

function parse(iso: string): Date {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** "8:25 PM" -> "8:25 pm", without lower-casing the month or weekday. */
function lowerPeriod(formatted: string): string {
  return formatted.replace(/\s(AM|PM)$/, (match) => match.toLowerCase());
}

const dayLabelFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Stable key for grouping transactions by calendar day: "2026-09-27". */
export function dayKey(iso: string): string {
  const date = parse(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "Today" / "Yesterday" / "26 Sep 2026". */
export function formatDayLabel(iso: string): string {
  const date = parse(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dayLabelFormatter.format(date);
}

/** "8:25 pm" */
export function formatTime(iso: string): string {
  return lowerPeriod(timeFormatter.format(parse(iso)));
}

/** "27 Sep 2026, 8:25 pm" */
export function formatDateTime(iso: string): string {
  return lowerPeriod(dateTimeFormatter.format(parse(iso)));
}

/** "AS" — used by the avatar circles. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** "9000000001" -> "+91 90000 00001" */
export function formatMobile(mobile: string | null | undefined): string {
  const digits = (mobile ?? "").replace(/\D/g, "");
  if (digits.length !== 10) return mobile ?? "—";
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** First name only, for greetings. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}
