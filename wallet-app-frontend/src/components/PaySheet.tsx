import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { vpaError } from "../lib/validation";
import { Button } from "./ui/Button";
import { Field, TextInput } from "./ui/Field";
import { IconPlus, IconScan, IconUser, IconWarning } from "./ui/Icons";
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

/** The centre action: how real UPI apps start a payment. */
export function PaySheet({ open, onClose }: PaySheetProps) {
  const navigate = useNavigate();
  const [showVpa, setShowVpa] = useState(false);
  const [vpa, setVpa] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const { resolve, busy, error, clearError } = usePayeeResolution();

  // Reset the inline form each time the sheet is reopened.
  useEffect(() => {
    if (!open) {
      setShowVpa(false);
      setVpa("");
      setIssue(null);
      clearError();
    }
  }, [open, clearError]);

  const go = (path: string, state?: unknown) => {
    onClose();
    navigate(path, state ? { state } : undefined);
  };

  const submitVpa = async () => {
    const problem = vpaError(vpa);
    setIssue(problem);
    if (problem) return;
    const ok = await resolve(vpa);
    if (ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pay someone"
      description="Scan a code or type a UPI ID. Money moves only inside this demo."
    >
      <div className="space-y-1">
        <OptionRow
          icon={<IconScan size={21} />}
          title="Scan any QR code"
          description="Point your camera at a PocketPay code"
          tone="bg-brand-50 text-brand-600"
          onClick={() => go("/scan")}
        />

        <OptionRow
          icon={<IconUser size={21} />}
          title="Pay by UPI ID"
          description="Type a handle like 9000000002@demoupi"
          tone="bg-fuchsia-50 text-fuchsia-600"
          onClick={() => setShowVpa((value) => !value)}
        />

        <OptionRow
          icon={<IconPlus size={21} />}
          title="Add money"
          description="Top up your own balance"
          tone="bg-emerald-50 text-emerald-600"
          onClick={() => go("/pay/amount", { mode: "topup" })}
        />
      </div>

      {showVpa ? (
        <div className="mt-3 animate-enter space-y-3 rounded-2xl bg-slate-50 p-3.5">
          <Field label="UPI ID" error={issue ?? error} hint="Example: 9000000002@demoupi">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                autoFocus
                placeholder="name@demoupi"
                value={vpa}
                invalid={Boolean(issue ?? error)}
                onChange={(event) => {
                  setVpa(event.target.value);
                  setIssue(null);
                  clearError();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitVpa();
                }}
              />
            )}
          </Field>
          <Button fullWidth loading={busy} onClick={() => void submitVpa()}>
            Continue
          </Button>
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-800">
        <IconWarning size={14} className="mt-px shrink-0" />
        A portfolio demo: there is no NPCI/UPI integration and no real payment rail.
      </p>
    </Sheet>
  );
}
