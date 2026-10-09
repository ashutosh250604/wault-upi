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

  // Lock background scrolling while open.
  //
  // Keyed off `open` alone, so the unlock always restores the overflow the page
  // really had. Sharing one effect with the two below meant a sheet that
  // re-rendered while open captured "hidden" as its previous value and left the
  // page unable to scroll after it closed.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Escape dismisses. Re-registering per render is free and keeps the handler
  // on the current props.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dismissible, onClose]);

  // Move focus into the dialog for keyboard and screen-reader users — once per
  // opening.
  //
  // This used to share one effect with the two above, and to re-arm itself
  // whenever the component re-rendered. Its target is the first control in the
  // panel, which is the header's close button, so any re-render while a sheet
  // was open pulled the caret out of whatever was being typed into and closed
  // the on-screen keyboard — one disappearing keyboard per character.
  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      const active = document.activeElement;
      // Whatever the user has already focused wins — this only runs on opening,
      // but a control that took focus itself must not be moved.
      if (panel && active instanceof HTMLElement && panel.contains(active)) return;
      // Prefer an explicit autofocus target over the header's close button.
      // (A combined selector wouldn't work: querySelector returns whichever
      // match comes first in document order, not the first selector listed.)
      const target =
        panel?.querySelector<HTMLElement>("[data-autofocus]") ??
        panel?.querySelector<HTMLElement>("input, button, [tabindex]:not([tabindex='-1'])");
      target?.focus();
    }, 30);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-ink-950/55 backdrop-blur-[2px]"
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
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-paper-25",
          "shadow-[0_30px_70px_-28px_rgba(15,15,13,0.6)]",
          "animate-slide-up rounded-t-[16px] sm:max-w-sm sm:rounded-[14px]",
          "pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-ink-300 sm:hidden" />
        {title ? (
          <div className="flex items-start gap-3 px-5 pt-4">
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="font-display text-[18px] font-bold tracking-tight text-ink-900"
              >
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mt-1 -mr-1 rounded-[6px] p-1.5 text-ink-400 transition hover:bg-paper-100 hover:text-ink-700"
              >
                <IconClose size={18} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div>
        {footer ? (
          <div className="border-t border-ink-200 bg-paper-50 px-5 py-4">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
