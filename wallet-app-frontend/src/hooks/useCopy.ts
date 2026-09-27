import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";

/** Copy to clipboard and expose a short-lived `copied` flag for the UI. */
export function useCopy(resetAfter = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetAfter);
      }
      return ok;
    },
    [resetAfter],
  );

  return { copied, copy };
}
