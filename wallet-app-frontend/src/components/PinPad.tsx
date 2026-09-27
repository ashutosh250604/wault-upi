import { useCallback } from "react";
import { cx } from "../lib/cx";
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
}: PinPadProps) {
  const locked = disabled || busy;

  const push = useCallback(
    (digit: string) => {
      if (locked || value.length >= PIN_LENGTH) return;
      const next = (value + digit).slice(0, PIN_LENGTH);
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
        <div className="flex items-center justify-center gap-3" role="group" aria-label="PIN entry">
          <span className="sr-only">{`PIN: ${value.length} of ${PIN_LENGTH} digits entered`}</span>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => {
            const filled = index < value.length;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={cx(
                  "flex size-11 items-center justify-center rounded-xl border text-2xl font-bold transition",
                  error
                    ? "border-rose-300 bg-rose-50 text-rose-500"
                    : filled
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-slate-50 text-slate-400",
                )}
              >
                {filled ? "•" : ""}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex h-5 items-center gap-1.5" aria-live="polite">
        {busy ? (
          <>
            <Spinner size={13} className="text-brand-600" />
            <span className="text-[13px] font-medium text-slate-500">{busyLabel}</span>
          </>
        ) : error ? (
          <span className="text-[13px] font-medium text-rose-600">{error}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-400">
            <IconLock size={13} /> Checked by the server before any money moves
          </span>
        )}
      </div>

      <div className="mx-auto mt-3 grid w-full max-w-[17rem] grid-cols-3 gap-1">
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
    </div>
  );
}
