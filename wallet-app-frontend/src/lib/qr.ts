/**
 * Decode a QR code from an image the user picked from their gallery.
 *
 * Uses the same detection engine that owns the bundle by the time the scanner
 * is open, so this costs no extra bytes.
 */

import { BarcodeDetector } from "barcode-detector/ponyfill";

let detector: BarcodeDetector | null = null;

function supported(): boolean {
  try {
    return typeof BarcodeDetector === "function";
  } catch {
    return false;
  }
}

/** Returns the first QR payload found in the image, or null. */
export async function decodeQrFromImage(file: Blob): Promise<string | null> {
  if (!supported()) return null;
  try {
    detector = detector ?? new BarcodeDetector({ formats: ["qr_code"] });
    // detect() accepts a Blob directly — no canvas round-trip needed.
    const codes = await detector.detect(file);
    return codes[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** True when a picked file looks like an image we can reasonably try. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") && file.size <= 10 * 1024 * 1024;
}
