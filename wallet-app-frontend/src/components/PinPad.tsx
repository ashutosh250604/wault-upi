import { useCallback, useEffect } from "react";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { useKeydown } from "../hooks/useKeydown";
import { IconBackspace, IconLock } from "./ui/Icons";
import { KeypadButton } from "./ui/KeypadButton";
import { Spinner } from "./ui/Spinner";

const PIN_LENGTH = 4;

export interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the fourth digit lands, if `autoSubmit` is on. */
  onComplete?: (pin: string) => void;
  autoSubmit?: boolean;
  error?: string | null;
  /** Bump this on every failure to replay the shake animation. */
  shakeToken?: number;
  busy?: boolean;
  disabled?: boolean;
  /** Reads "Verifying…" while the PIN is checked server-side. */
  busyLabel?: string;
  /** Shows a "Forgot PIN?" escape hatch when provided. */
  onForgotPin?: () => void;
}

export function PinPad({
  value,
  onChange,
  onComplete,
  autoSubmit = true,
  error,
  shakeToken = 0,
  busy = false,
  disabled = false,
  busyLabel = "Verifying…",
  onForgotPin,
}: PinPadProps) {
  const locked = disabled || busy;

  // A failed attempt should be felt, not just read.
  useEffect(() => {
    if (error && !busy) feedback.error();
  }, [error, busy, shakeToken]);

  const push = useCallback(
    (digit: string) => {
      if (locked || value.length >= PIN_LENGTH) return;
      const next = (value + digit).slice(0, PIN_LENGTH);
      feedback.digit();
      onChange(next);
      if (autoSubmit && next.length === PIN_LENGTH) onComplete?.(next);
    },
    [locked, value, onChange, autoSubmit, onComplete],
  );

  const pop = useCallback(() => {
    if (locked) return;
    onChange(value.slice(0, -1));
  }, [locked, value, onChange]);

  useKeydown(
    useCallback(
      (event: KeyboardEvent) => {
        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          push(event.key);
        } else if (event.key === "Backspace") {
          event.preventDefault();
          pop();
        }
      },
      [push, pop],
    ),
    !locked,
  );

  return (
    <div className="flex flex-col items-center">
      <div key={shakeToken} className={cx(error && "animate-shake")}>
        <div className="flex items-center justify-center gap-2.5" role="group" aria-label="PIN entry">
          <span className="sr-only">{`PIN: ${value.length} of ${PIN_LENGTH} digits entered`}</span>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => {
            const filled = index < value.length;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={cx(
                  "flex h-14 w-12 items-center justify-center rounded-[8px] border transition-colors duration-150",
                  error
                    ? "border-seal-300 bg-seal-50"
                    : filled
                      ? "border-ink-900 bg-ink-900"
                      : "border-ink-200 bg-paper-100",
                )}
              >
                {filled ? (
                  <span
                    className={cx(
                      "size-2.5 animate-pop rounded-[2px]",
                      error ? "bg-seal-500" : "bg-paper-25",
                    )}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex h-5 items-center gap-1.5" aria-live="polite">
        {busy ? (
          <>
            <Spinner size={13} className="text-ink-900" />
            <span className="text-[13px] font-medium text-ink-500">{busyLabel}</span>
          </>
        ) : error ? (
          <span className="text-[13px] font-medium text-seal-700">{error}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-400">
            <IconLock size={13} /> Checked by the server before any money moves
          </span>
        )}
      </div>

      <div className="mx-auto mt-3 grid w-full max-w-[17.5rem] grid-cols-3 gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit, index) => (
          <KeypadButton
            key={digit}
            disabled={locked}
            aria-label={digit}
            data-autofocus={index === 0 ? "" : undefined}
            onClick={() => push(digit)}
          >
            {digit}
          </KeypadButton>
        ))}
        <span aria-hidden="true" />
        <KeypadButton disabled={locked} aria-label="0" onClick={() => push("0")}>
          0
        </KeypadButton>
        <KeypadButton
          muted
          disabled={locked || value.length === 0}
          aria-label="Delete last digit"
          onClick={pop}
        >
          <IconBackspace size={22} />
        </KeypadButton>
      </div>

      {onForgotPin ? (
        <button
          type="button"
          disabled={busy}
          onClick={onForgotPin}
          className="mt-3 rounded-[5px] px-2 py-1 text-[12.5px] font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4 transition hover:decoration-seal-600 disabled:opacity-50"
        >
          Forgot PIN?
        </button>
      ) : null}
    </div>
  );
}
