/**
 * UPI-style payload parsing. Kept out of the scanner component so the QR
 * scanner, the gallery upload and any future paste-a-code path all agree.
 */

export interface ScannedPayment {
  vpa: string;
  name?: string;
  /** Amount encoded in the code, in rupees. */
  amount?: number;
  note?: string;
}

/**
 * The `upi://pay?...` string the "My QR" screen encodes — the one place the app
 * builds a deep link, so the scanner, the gallery upload and the QR renderer all
 * agree on its shape.
 */
export function buildPaymentPayload(
  vpa: string,
  name: string | null | undefined,
  amount?: number,
  note?: string,
): string {
  const params = new URLSearchParams({
    pa: vpa,
    pn: name?.trim() || "WAULT user",
    cu: "INR",
  });
  if (amount && amount > 0) params.set("am", amount.toFixed(2));
  if (note?.trim()) params.set("tn", note.trim());
  // URLSearchParams encodes spaces as "+", which some scanners mis-read.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

function positiveNumber(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Pull a payment out of whatever the camera or an uploaded image contained:
 * a `upi://pay?pa=…` deep link, or a bare `name@bank` string.
 */
export function parsePaymentCode(raw: string | null | undefined): ScannedPayment | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const vpa = url.searchParams.get("pa") ?? url.searchParams.get("vpa");
      if (!vpa) return null;
      return {
        vpa: vpa.trim().toLowerCase(),
        name: url.searchParams.get("pn")?.trim() || undefined,
        amount: positiveNumber(url.searchParams.get("am")),
        note: url.searchParams.get("tn")?.trim() || undefined,
      };
    } catch {
      return null;
    }
  }

  if (/^[^\s@]+@[^\s@]+$/.test(text)) return { vpa: text.toLowerCase() };
  return null;
}
