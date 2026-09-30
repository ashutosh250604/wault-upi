import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { mobileError, vpaError } from "../lib/validation";
import { useRecentPeople } from "../hooks/useRecentPeople";
import { PeopleStrip } from "./People";
import { Button } from "./ui/Button";
import { Field, TextInput } from "./ui/Field";
import { IconPhone, IconPlus, IconScan, IconUser, IconWarning } from "./ui/Icons";
import { Sheet } from "./ui/Sheet";

export interface PaySheetProps {
  open: boolean;
  onClose: () => void;
}

function OptionRow({
  icon,
  title,
  description,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl p-2.5 text-left transition hover:bg-slate-50 active:bg-slate-100"
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold text-slate-900">{title}</span>
        <span className="block text-[12.5px] text-slate-500">{description}</span>
      </span>
    </button>
  );
}

type EntryMode = "mobile" | "vpa" | null;

/** The centre action: how real UPI apps start a payment. */
export function PaySheet({ open, onClose }: PaySheetProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<EntryMode>(null);
  const [value, setValue] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const { resolve, startPayment, busy, error, clearError } = usePayeeResolution();
  // Recents load with the sheet, so the fastest path is one tap from opening.
  const { people, status, reload } = useRecentPeople(8);

  // Reset the inline form each time the sheet is reopened.
  useEffect(() => {
    if (!open) {
      setMode(null);
      setValue("");
      setIssue(null);
      clearError();
    }
  }, [open, clearError]);

  const go = (path: string, state?: unknown) => {
    onClose();
    navigate(path, state ? { state } : undefined);
  };

  const openEntry = (next: Exclude<EntryMode, null>) => {
    setMode((current) => (current === next ? null : next));
    setValue("");
    setIssue(null);
    clearError();
  };

  const submit = async () => {
    const problem = mode === "mobile" ? mobileError(value) : vpaError(value);
    setIssue(problem);
    if (problem) return;
    const ok = await resolve(value);
    if (ok) onClose();
  };

  const isMobile = mode === "mobile";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pay someone"
      description="Pick a recent contact, scan a code, or enter a number or UPI ID."
    >
      {people && people.length > 0 ? (
        <div className="mb-4">
          <p className="mb-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
            Recents
          </p>
          <PeopleStrip
            people={people}
            status={status}
            showCaption
            onSelect={(person) => {
              onClose();
              startPayment(person);
            }}
            onRetry={reload}
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <OptionRow
          icon={<IconScan size={21} />}
          title="Scan any QR code"
          description="Point your camera at a PocketPay code"
          tone="bg-brand-50 text-brand-600"
          onClick={() => go("/scan")}
        />
        <OptionRow
          icon={<IconPhone size={21} />}
          title="Pay to mobile number"
          description="Any 10-digit number on this demo network"
          tone="bg-emerald-50 text-emerald-600"
          onClick={() => openEntry("mobile")}
        />
        <OptionRow
          icon={<IconUser size={21} />}
          title="Pay to UPI ID"
          description="A handle like 9000000002@demoupi"
          tone="bg-fuchsia-50 text-fuchsia-600"
          onClick={() => openEntry("vpa")}
        />
        <OptionRow
          icon={<IconPlus size={21} />}
          title="Add money"
          description="Top up your own balance"
          tone="bg-slate-100 text-slate-600"
          onClick={() => go("/pay/amount", { mode: "topup" })}
        />
      </div>

      {mode ? (
        <div className="mt-3 animate-enter space-y-3 rounded-2xl bg-slate-50 p-3.5">
          <Field
            label={isMobile ? "Mobile number" : "UPI ID"}
            error={issue ?? error}
            hint={isMobile ? "Try 9000000004" : "Try 9000000002@demoupi"}
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                data-autofocus
                inputMode={isMobile ? "tel" : "text"}
                placeholder={isMobile ? "10-digit mobile number" : "name@demoupi"}
                value={value}
                invalid={Boolean(issue ?? error)}
                onChange={(event) => {
                  setValue(event.target.value);
                  setIssue(null);
                  clearError();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
            )}
          </Field>
          <Button fullWidth loading={busy} onClick={() => void submit()}>
            Continue
          </Button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => go("/people")}
        className="mt-3 w-full rounded-2xl border border-dashed border-slate-200 py-3 text-[12.5px] font-semibold text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
      >
        Manage contacts
      </button>

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-800">
        <IconWarning size={14} className="mt-px shrink-0" />
        A portfolio demo: there is no NPCI/UPI integration and no real payment rail.
      </p>
    </Sheet>
  );
}
