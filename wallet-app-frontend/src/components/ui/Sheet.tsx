import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/cx";
import { IconClose } from "./Icons";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Payments in flight set this so a stray tap can't dismiss the sheet. */
  dismissible?: boolean;
  className?: string;
}

/**
 * Modal surface: a bottom sheet on phones, a centred dialog from `sm` up.
 * Rendered in a portal so it can't be clipped by the app shell's overflow.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Escape to dismiss + lock background scrolling while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    // Move focus into the dialog for keyboard and screen-reader users.
    const focusTimer = window.setTimeout(() => {
      // Prefer an explicit autofocus target over the header's close button.
      // (A combined selector wouldn't work: querySelector returns whichever
      // match comes first in document order, not the first selector listed.)
      const panel = panelRef.current;
      const target =
        panel?.querySelector<HTMLElement>("[data-autofocus]") ??
        panel?.querySelector<HTMLElement>("input, button, [tabindex]:not([tabindex='-1'])");
      target?.focus();
    }, 30);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-900/45 backdrop-blur-[2px]"
        onClick={() => dismissible && onClose()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cx(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-2xl",
          "animate-slide-up rounded-t-3xl sm:max-w-sm sm:rounded-3xl",
          "pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden" />
        {title ? (
          <div className="flex items-start gap-3 px-5 pt-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[17px] font-bold text-slate-900">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-[13px] text-slate-500">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mt-1 -mr-1 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <IconClose size={18} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div>
        {footer ? (
          <div className="border-t border-slate-100 bg-white px-5 py-4">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
