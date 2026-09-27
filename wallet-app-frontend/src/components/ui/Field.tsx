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
      <label htmlFor={id} className="block text-[13px] font-medium text-slate-600">
        {label}
      </label>
      {children({ id, describedBy })}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-slate-500">
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
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[15px] font-medium text-slate-500">
          {prefix}
        </span>
      ) : null}
      <input
        aria-invalid={invalid || undefined}
        className={cx(
          "h-12 w-full rounded-xl border bg-white text-[15px] text-slate-900 shadow-xs transition",
          "placeholder:text-slate-400",
          "focus:outline-none focus:ring-4",
          align === "center" ? "text-center tracking-[0.25em]" : "text-left",
          prefix ? "pl-12" : "pl-3.5",
          suffix ? "pr-12" : "pr-3.5",
          invalid
            ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/15"
            : "border-slate-200 focus:border-brand-500 focus:ring-brand-500/15",
          "disabled:bg-slate-50 disabled:text-slate-500",
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
        "w-full resize-none rounded-xl border bg-white p-3.5 text-[15px] text-slate-900 shadow-xs transition",
        "placeholder:text-slate-400 focus:outline-none focus:ring-4",
        invalid
          ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/15"
          : "border-slate-200 focus:border-brand-500 focus:ring-brand-500/15",
        className,
      )}
      {...rest}
    />
  );
}
