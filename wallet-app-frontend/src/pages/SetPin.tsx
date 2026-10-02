import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { PIN_RE } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell, AppBar } from "../components/AppShell";
import { PinPad } from "../components/PinPad";
import { Card } from "../components/ui/Card";
import { IconInfo, IconWarning } from "../components/ui/Icons";
import { StepDots } from "../components/ui/StepDots";

type Stage = "create" | "confirm";

export default function SetPinPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, patchProfile, refresh } = useAppSession();

  const [stage, setStage] = useState<Stage>("create");
  const [value, setValue] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shakeToken, setShakeToken] = useState(0);
  const [busy, setBusy] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const onComplete = async (pin: string) => {
    if (!PIN_RE.test(pin)) return;

    if (stage === "create") {
      setFirstPin(pin);
      setValue("");
      setError(null);
      setStage("confirm");
      return;
    }

    if (pin !== firstPin) {
      setError("Those PINs didn't match. Start again.");
      setShakeToken((token) => token + 1);
      setValue("");
      setFirstPin("");
      setStage("create");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.setPin(pin);
      // The cached profile was fetched before this PIN existed; without the
      // patch, home would keep showing "Set your PIN to start paying".
      patchProfile({ has_pin: true });
      void refresh({ silent: true });
      toast.success("PIN set — you're ready to pay");
      navigate("/home", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setShakeToken((token) => token + 1);
      setValue("");
      setFirstPin("");
      setStage("create");
    } finally {
      setBusy(false);
    }
  };

  const isConfirm = stage === "confirm";

  return (
    <AppShell
      header={
        <AppBar
          title={isConfirm ? "Confirm your PIN" : "Create your PIN"}
          right={<StepDots total={2} current={2} />}
          border={false}
        />
      }
      footer={
        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <PinPad
            value={value}
            onChange={setValue}
            onComplete={(pin) => void onComplete(pin)}
            error={error}
            shakeToken={shakeToken}
            busy={busy}
            busyLabel="Saving your PIN…"
            autoSubmit={!busy}
          />
        </div>
      }
    >
      <div className="px-5 py-5">
        <h2 className="text-[20px] font-bold tracking-tight text-slate-900">
          {isConfirm ? "Enter it once more" : "Choose a 4-digit PIN"}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">
          {isConfirm
            ? "Confirm the PIN you just chose so we know it wasn't a typo."
            : "You'll enter this PIN to approve every payment. Keep it private — you'll need it for every transfer."}
        </p>

        <div className="mt-6 space-y-3">
          <Card
            tone="muted"
            className="flex gap-2.5"
            aria-live="polite"
          >
            <IconWarning size={16} className="mt-px shrink-0 text-amber-500" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              Five wrong attempts lock the PIN for 15 minutes. That lockout is enforced
              by the server, not just the screen.
            </p>
          </Card>

          <Card className="flex gap-2.5">
            <IconInfo size={16} className="mt-px shrink-0 text-slate-400" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              Your PIN is stored as a salted scrypt hash — the plain PIN is never
              written to the database, and no API response ever returns it.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
