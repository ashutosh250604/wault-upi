import { useCallback } from "react";
import { sanitizeAmountInput } from "../lib/validation";
import { useKeydown } from "../hooks/useKeydown";
import { IconBackspace } from "./ui/Icons";
import { KeypadButton } from "./ui/KeypadButton";

const MAX_INPUT_LENGTH = 12;

export interface AmountKeypadProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/** Numeric pad for entering a rupee amount: digits, `00`, `.` and backspace. */
export function AmountKeypad({ value, onChange, disabled = false }: AmountKeypadProps) {
  const append = useCallback(
    (chunk: string) => {
      if (disabled) return;
      const next = sanitizeAmountInput(value + chunk);
      if (next.length <= MAX_INPUT_LENGTH) onChange(next);
    },
    [disabled, value, onChange],
  );

  const backspace = useCallback(() => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  }, [disabled, value, onChange]);

  useKeydown(
    useCallback(
      (event: KeyboardEvent) => {
        if (/^\d$/.test(event.key) || event.key === ".") {
          event.preventDefault();
          append(event.key);
        } else if (event.key === "Backspace") {
          event.preventDefault();
          backspace();
        }
      },
      [append, backspace],
    ),
    !disabled,
  );

  const hasDecimal = value.includes(".");

  return (
    <div className="mx-auto grid w-full max-w-[17rem] grid-cols-3 gap-1">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
        <KeypadButton
          key={digit}
          disabled={disabled}
          aria-label={digit}
          onClick={() => append(digit)}
        >
          {digit}
        </KeypadButton>
      ))}
      <KeypadButton
        muted
        disabled={disabled || hasDecimal || value.length === 0}
        aria-label="Decimal point"
        onClick={() => append(".")}
      >
        <span className="text-xl font-semibold">.</span>
      </KeypadButton>
      <KeypadButton disabled={disabled} aria-label="0" onClick={() => append("0")}>
        0
      </KeypadButton>
      <KeypadButton
        muted
        disabled={disabled || value.length === 0}
        aria-label="Delete last digit"
        onClick={backspace}
      >
        <IconBackspace size={20} />
      </KeypadButton>
    </div>
  );
}
