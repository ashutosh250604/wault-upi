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

/**
 * Every clock in the app reads IST, whoever is looking at it.
 *
 * The server stores and compares in UTC and the API hands out UTC instants; this
 * is the one place that turns them into something a person reads, which is what
 * keeps a timestamp from being rendered in two different zones on two screens.
 * India has had no daylight saving since 1945, so the zone is named rather than
 * offset by hand.
 */
export const TIME_ZONE = "Asia/Kolkata";

function parse(iso: string): Date {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

// Dates are printed DD-MM-YYYY — the Indian format, and the one the statements
// and CSV exports have always used. `en-IN` with numeric day/month would render
// 09/10/2026 (slashes) on V8, so dates and times are rebuilt from their parts to
// keep the separator identical to the server's `%d-%m-%Y` exports.
const dayLabelFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function partMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return map;
}

/** "09-10-2026" on the IST calendar, whatever zone or locale the browser has. */
function dateText(date: Date): string {
  const parts = partMap(dayLabelFormatter.formatToParts(date));
  return `${parts.day}-${parts.month}-${parts.year}`;
}

/** "7:58 am" — lower-case period, as the app has always shown. */
function timeText(date: Date): string {
  const parts = partMap(timeFormatter.formatToParts(date));
  return `${parts.hour}:${parts.minute} ${(parts.dayPeriod ?? "").toLowerCase()}`.trim();
}

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  hour12: false,
});

/** The IST calendar day as year/month/day numbers, whatever the browser's zone is. */
function istDay(date: Date): [number, number, number] {
  const parts = dayKeyFormatter.formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return [value("year"), value("month"), value("day")];
}

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Days since the epoch for an IST calendar day, so two days can be subtracted. */
function istDayNumber(date: Date): number {
  const [year, month, day] = istDay(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * The hour on the IST clock, 0-23.
 *
 * A greeting has to be the user's morning, not the server's — this is why the
 * app never asks the browser what time it is.
 */
export function istHour(now: Date = new Date()): number {
  return Number(hourFormatter.format(now)) % 24;
}

/** Stable key for grouping transactions by IST calendar day: "2026-09-27". */
export function dayKey(iso: string): string {
  const [year, month, day] = istDay(parse(iso));
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}

/** "Today" / "Yesterday" / "05-10-2026". */
export function formatDayLabel(iso: string): string {
  const date = parse(iso);
  const diff = istDayNumber(new Date()) - istDayNumber(date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dateText(date);
}

/** "8:25 pm" */
export function formatTime(iso: string): string {
  return timeText(parse(iso));
}

/** "05-10-2026, 8:25 pm" */
export function formatDateTime(iso: string): string {
  const date = parse(iso);
  return `${dateText(date)}, ${timeText(date)}`;
}

/** A `Date`'s day as "2026-10-05", for the statement picker's query params. */
export function istDateParam(date: Date): string {
  const [year, month, day] = istDay(date);
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}

/**
 * "AS" — used by the avatar stamps. Brackets and punctuation are dropped first
 * so a nickname like "Ananya (college)" stamps "AC" rather than "A(".
 */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "")
    .replace(/[()[\]{}.,'"`~!@#$%^&*_+=|\\/<>?:;·—-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "OV";
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
