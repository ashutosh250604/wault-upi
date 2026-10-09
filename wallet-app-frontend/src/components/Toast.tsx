import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { BrandSeal } from "./AppShell";
import { type IconTone } from "../lib/tiles";
import { IconTile } from "./ui/IconTile";
import {
  IconCheck,
  IconClose,
  IconInfo,
  IconWarning,
} from "./ui/Icons";
import {
  ToastContext,
  type ToastApi,
  type ToastMessage,
  type ToastTone,
} from "../hooks/toast";

/**
 * A toast is a receipt that arrives on its own: the state stamped in a square,
 * the message set large enough to be read at arm's length. It is deliberately
 * the loudest small object in the app — everything else waits to be looked at,
 * and this interrupts.
 *
 * The tone is said once, by the tile: a filled square of the tone's own ink with
 * the cream paper knocked out of the glyph, which is louder than a tinted chip
 * and reads even where the paper behind it does not. There used to be a 5px
 * strip of the same ink down the toast's left edge as well. It was doing nothing
 * the tile was not already doing, and where the toast sat on a surface of a
 * similar colour it was the one part of the toast that vanished — which made a
 * complete toast look clipped. It is gone, and the slip is now inset the same on
 * both sides.
 */
const TONES: Record<ToastTone, { tone: IconTone; icon: ReactNode }> = {
  success: { tone: "credit", icon: <IconCheck size={16} strokeWidth={2.4} /> },
  error: { tone: "seal", icon: <IconWarning size={16} strokeWidth={2.2} /> },
  info: { tone: "ink", icon: <IconInfo size={16} strokeWidth={2.2} /> },
};

/**
 * App-wide transient feedback. Errors linger longer and announce assertively;
 * everything else is polite so it doesn't interrupt a screen reader mid-sentence.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<ToastApi["notify"]>(
    (message, tone = "info", action) => {
      const id = nextId.current++;
      // Keep at most three on screen so the top of the app stays readable.
      setToasts((current) => [...current.slice(-2), { id, tone, message, action }]);
      const timeout = window.setTimeout(() => dismiss(id), tone === "error" ? 6500 : 4000);
      timers.current.set(id, timeout);
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (message) => notify(message, "success"),
      error: (message) => notify(message, "error"),
      info: (message, action) => notify(message, "info", action),
      dismiss,
    }),
    [notify, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The toasts hang off the viewport rather than the app frame, so on a
          laptop they used to start 12px from the top of the window while the
          frame itself begins 20px down — the slip poked out above the surface it
          belongs to and read as clipped. The desktop offset now clears the
          frame's top edge with room to spare. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2.5 px-3 pt-[max(1rem,env(safe-area-inset-top))] sm:pt-9">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            className={cx(
              "pointer-events-auto relative flex w-full max-w-[22rem] animate-slide-up items-start gap-3 overflow-hidden rounded-[13px] pl-3.5",
              // A warm slip with an inked edge and a hard print shadow: it has to
              // read as paper on the ink hero as well as on the page, and to sit
              // above both rather than blend into either.
              "border-[1.5px] border-ink-900 bg-paper-25 py-3.5 pr-2.5",
              "shadow-[4px_4px_0_0_rgba(25,25,22,0.85)]",
            )}
          >
            {/* A filled `IconTile`, not a bespoke square: the toast's mark and
                the row's mark are the same tile, one speaking at full volume
                and one saying it quietly. */}
            <IconTile tone={TONES[toast.tone].tone} scale="xs" solid>
              {TONES[toast.tone].icon}
            </IconTile>
            {/* The message is the whole toast: set at 14px semibold rather than
                the 13px medium it used to be, which read as a tooltip. */}
            <p className="flex-1 pt-0.5 text-[14px] leading-[1.4] font-semibold text-ink-900">
              {toast.message}
            </p>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action?.onClick();
                }}
                className="shrink-0 rounded-[6px] border-[1.5px] border-ink-900/20 bg-paper-100 px-2.5 py-1.5 text-[12.5px] font-bold text-seal-700 transition hover:border-ink-900/50 hover:bg-paper-200 active:bg-paper-300"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mt-0.5 -mr-1 shrink-0 rounded-[6px] p-1.5 text-ink-500 transition hover:bg-paper-100 hover:text-ink-900"
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}

        {/* The queue's own watermark: a hairline seal under the stack, so the
            corner of the app that talks back to you is branded too. */}
        {toasts.length > 1 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none -mt-1 flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-500"
          >
            <BrandSeal size={12} />
            {toasts.length} notifications
          </span>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
