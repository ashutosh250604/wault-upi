/** Clipboard + Web Share helpers with graceful fallbacks. */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or an insecure context — fall through to execCommand.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export interface SharePayload {
  title: string;
  text: string;
}

export type ShareResult = "shared" | "copied" | "failed";

/**
 * Prefers the native share sheet (mobile), and otherwise copies the receipt so
 * the user still walks away with something they can paste.
 */
export async function shareText(payload: SharePayload): Promise<ShareResult> {
  const nav = navigator as Navigator & {
    share?: (data: SharePayload) => Promise<void>;
  };
  if (typeof nav.share === "function") {
    try {
      await nav.share(payload);
      return "shared";
    } catch (error) {
      // Dismissing the sheet isn't an error worth reporting.
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }
  return (await copyText(payload.text)) ? "copied" : "failed";
}
