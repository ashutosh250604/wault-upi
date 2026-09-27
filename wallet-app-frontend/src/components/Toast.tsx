import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
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

const TONES: Record<ToastTone, { ring: string; icon: ReactNode }> = {
  success: {
    ring: "ring-emerald-200 bg-emerald-50 text-emerald-900",
    icon: (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <IconCheck size={13} />
      </span>
    ),
  },
  error: {
    ring: "ring-rose-200 bg-rose-50 text-rose-900",
    icon: (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white">
        <IconWarning size={13} />
      </span>
    ),
  },
  info: {
    ring: "ring-slate-200 bg-white text-slate-800",
    icon: (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white">
        <IconInfo size={13} />
      </span>
    ),
  },
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
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            className={cx(
              "pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-2.5 rounded-2xl px-3.5 py-3 shadow-lg ring-1 backdrop-blur",
              TONES[toast.tone].ring,
            )}
          >
            <span className="pt-0.5">{TONES[toast.tone].icon}</span>
            <p className="flex-1 text-[13px] leading-snug font-medium">{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action?.onClick();
                }}
                className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-bold underline decoration-2 underline-offset-2 hover:bg-black/5"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mt-0.5 -mr-1 shrink-0 rounded-full p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"
            >
              <IconClose size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
