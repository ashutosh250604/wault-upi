import { useEffect } from "react";

/**
 * Physical-keyboard support for the on-screen keypads, so a desktop user can
 * just type. Skips events aimed at real text inputs.
 */
export function useKeydown(handler: (event: KeyboardEvent) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      handler(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handler, enabled]);
}
