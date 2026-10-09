import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cx } from "../../lib/cx";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
  className?: string;
}

/**
 * Label + control + error wiring in one place, so every input in the app gets
 * the same association between label, hint and error text.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-ink-800">
        {label}
      </label>
      {children({ id, describedBy })}
      {error ? (
        <p id={errorId} role="alert" className="text-[12.5px] font-medium text-seal-700">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[12.5px] text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// `prefix` is dropped from the HTML attributes so it can mean a visual adornment.
export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  invalid?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Larger, centre-aligned text for OTP / PIN style inputs. */
  align?: "left" | "center";
}

/**
 * A field is a well pressed into the paper: warm sheet (one step deeper than the
 * page, so it reads as a recess rather than a white box), inked 1.5px hairline,
 * a soft shadow along the top inside edge, and a wide, low-contrast halo on
 * focus. The colour pair never changes — only the weight of the rule does.
 *
 * The placeholder is the lighter ink, deliberately: an empty field must not read
 * as a filled one, so what a user has typed is always the darker of the two.
 */
const INPUT_BASE =
  "w-full border-[1.5px] bg-paper-100 text-[15px] text-ink-900 transition placeholder:text-ink-400 focus:outline-none focus:ring-4 disabled:bg-paper-200 disabled:text-ink-500";

function inputTone(invalid: boolean): string {
  return invalid
    ? "border-seal-500 shadow-[inset_0_1.5px_3px_rgba(82,25,18,0.09)] focus:border-seal-600 focus:ring-seal-500/20"
    : "border-ink-900/80 shadow-[inset_0_1.5px_3px_rgba(15,15,13,0.07)] focus:border-ink-900 focus:ring-ink-900/10";
}

export function TextInput({
  invalid = false,
  prefix,
  suffix,
  align = "left",
  className,
  ...rest
}: TextInputProps) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-[14.5px] font-semibold text-ink-500">
          {prefix}
        </span>
      ) : null}
      <input
        aria-invalid={invalid || undefined}
        className={cx(
          INPUT_BASE,
          "h-12 rounded-[10px]",
          align === "center"
            ? "text-center font-display text-[17px] font-semibold tracking-[0.18em] tabular-nums"
            : "text-left",
          prefix ? "pl-12" : "pl-3.5",
          suffix ? "pr-12" : "pr-3.5",
          inputTone(invalid),
          className,
        )}
        {...rest}
      />
      {suffix ? (
        <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{suffix}</span>
      ) : null}
    </div>
  );
}

export function TextArea({
  invalid = false,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx(
        INPUT_BASE,
        "resize-none rounded-[10px] p-3.5",
        inputTone(invalid),
        className,
      )}
      {...rest}
    />
  );
}
