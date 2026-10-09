import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { saveBlob } from "../lib/download";
import { istDateParam } from "../lib/format";
import { useToast } from "../hooks/toast";
import { Button, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { IconDownload } from "./ui/Icons";
import { Sheet } from "./ui/Sheet";

/** Today on the IST clock, as year/month/day numbers. */
function istToday(): [number, number, number] {
  const [year, month, day] = istDateParam(new Date()).split("-").map(Number);
  return [year, month, day];
}

/** Move a month index by `delta` months, rolling the year when it wraps. */
function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const index = year * 12 + (month - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
}

const pad = (value: number) => `${value}`.padStart(2, "0");

/** One calendar day as `YYYY-MM-DD`, which is what the API's query takes. */
function isoDay(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The same day as the reader sees it: DD-MM-YYYY. */
function displayDay(year: number, month: number, day: number): string {
  return `${pad(day)}-${pad(month)}-${year}`;
}

interface Period {
  key: string;
  label: string;
  /** What the statement will cover, spelled out under the label. */
  detail: string;
  /** Inclusive day range in the user's calendar; absent means "everything". */
  from?: string;
  to?: string;
}

/**
 * The periods people actually ask for. Everything is a calendar boundary
 * rather than a rolling window, so the same statement can be re-downloaded
 * later and match what an accountant already has.
 */
function periods(): Period[] {
  // Every boundary here is built from the IST calendar — the one the statement
  // itself is grouped by and the days are printed in. Deriving them from the
  // browser's own Date parts would hand a reader west of IST a window that
  // starts a day late and a month that ends a day early.
  const [year, month, day] = istToday();
  const [thisYear, thisMonth] = shiftMonth(year, month, 0);
  const [prevYear, prevMonth] = shiftMonth(year, month, -1);
  const [backYear, backMonth] = shiftMonth(year, month, -2);
  const prevMonthDays = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();

  return [
    {
      key: "this-month",
      label: "This month",
      detail: `${displayDay(thisYear, thisMonth, 1)} to today`,
      from: isoDay(thisYear, thisMonth, 1),
      to: isoDay(year, month, day),
    },
    {
      key: "last-month",
      label: "Last month",
      detail: `${displayDay(prevYear, prevMonth, 1)} to ${displayDay(prevYear, prevMonth, prevMonthDays)}`,
      from: isoDay(prevYear, prevMonth, 1),
      to: isoDay(prevYear, prevMonth, prevMonthDays),
    },
    {
      key: "three-months",
      label: "Last 3 months",
      detail: `${displayDay(backYear, backMonth, 1)} to today`,
      from: isoDay(backYear, backMonth, 1),
      to: isoDay(year, month, day),
    },
    {
      key: "all",
      label: "All time",
      detail: "Every payment, top-up and reward",
    },
  ];
}

export interface StatementDownloadProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/**
 * "Download statement" + the period it should cover. The file is built on the
 * server from the ledger, so it can't drift from the rows on screen.
 */
export function StatementDownload({
  variant = "secondary",
  size = "sm",
  fullWidth = false,
  className,
}: StatementDownloadProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("this-month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = periods();
  const chosen = options.find((period) => period.key === selected) ?? options[0];

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.statementPdf({
        from: chosen.from,
        to: chosen.to,
      });
      saveBlob(blob, filename);
      toast.success(`Statement saved as ${filename}`);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        className={className}
        leftIcon={<IconDownload size={size === "lg" ? 17 : 15} />}
        onClick={() => setOpen(true)}
      >
        Download statement (PDF)
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Download statement"
        description="A branded PDF of your WAULT activity."
        dismissible={!busy}
        footer={
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            leftIcon={<IconDownload size={17} />}
            onClick={() => void download()}
          >
            Download {chosen.label.toLowerCase()}
          </Button>
        }
      >
        <div role="radiogroup" aria-label="Statement period" className="space-y-2">
          {options.map((period) => {
            const active = period.key === selected;
            return (
              <button
                key={period.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(period.key)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-[10px] border-[1.5px] px-3.5 py-3 text-left transition",
                  "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
                  active
                    ? "border-ink-900 bg-paper-100"
                    : "border-ink-200 bg-paper-25 hover:bg-paper-100",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    active ? "border-ink-900" : "border-ink-400",
                  )}
                >
                  {active ? <span className="size-2 rounded-full bg-ink-900" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink-900">
                    {period.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-500">{period.detail}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div aria-live="polite" className="min-h-5">
          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] font-medium text-seal-700">
              {error}
            </p>
          ) : null}
        </div>

        <p className="text-[11.5px] leading-relaxed text-ink-500">
          The PDF carries your UPI ID, the period you pick and every entry in it —
          payments, top-ups and rewards, signed from your side of the ledger.
        </p>
      </Sheet>
    </>
  );
}
