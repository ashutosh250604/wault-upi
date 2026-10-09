import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { formatMobile } from "../lib/format";
import { otpNotice } from "../lib/otp";
import { MOBILE_RE, OTP_RE, PIN_RE, mobileError } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { PinPad } from "../components/PinPad";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field, TextInput } from "../components/ui/Field";
import { IconInfo, IconWarning } from "../components/ui/Icons";
import { StepDots } from "../components/ui/StepDots";

/**
 * Forgot PIN: the registered number, a one-time code, a new PIN.
 *
 * A PIN is not recoverable — it is stored as a hash, so nobody can read it back,
 * not even the server — and until this screen existed a forgotten one left the
 * wallet unusable for good. What is recoverable is the *phone*: proving it can
 * read a code is enough to choose a new PIN, and nothing more. The proven phone
 * buys a ten-minute token and the token buys one PIN; it never signs anybody in,
 * so a half-finished reset leaves the account exactly as locked as it was.
 *
 * Every check that matters happens on the server. This screen validates formats
 * to keep the buttons honest, and nothing else.
 */

type Stage = "mobile" | "code" | "create" | "confirm";

const STAGE_STEP: Record<Stage, number> = {
  mobile: 1,
  code: 2,
  create: 3,
  confirm: 3,
};

export default function ForgotPinPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated } = useAppSession();

  const [stage, setStage] = useState<Stage>("mobile");
  const [mobile, setMobile] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shakeToken, setShakeToken] = useState(0);
  const [busy, setBusy] = useState(false);

  // Someone already signed in has a PIN they can use; if they want a new one,
  // they can start from the sign-in screen instead of resetting mid-session.
  if (isAuthenticated) return <Navigate to="/home" replace />;

  const notice = otpNotice(devOtp);

  const requestCode = async () => {
    const problem = mobileError(mobile);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.forgotPin(mobile);
      setDevOtp(result.dev_otp ?? null);
      setStage("code");
      setCode("");
      toast.success(result.message);
    } catch (err) {
      setError(errorMessage(err));
      feedback.warn();
    } finally {
      setBusy(false);
    }
  };

  const checkCode = async () => {
    if (!OTP_RE.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyResetOtp(mobile, code);
      setResetToken(result.reset_token);
      setStage("create");
      toast.success(result.message);
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
      feedback.warn();
    } finally {
      setBusy(false);
    }
  };

  const choosePin = async (entered: string) => {
    if (!PIN_RE.test(entered)) return;

    if (stage === "create") {
      setFirstPin(entered);
      setPinValue("");
      setError(null);
      setStage("confirm");
      return;
    }

    if (entered !== firstPin) {
      setError("Those PINs didn't match. Start again.");
      setShakeToken((token) => token + 1);
      setPinValue("");
      setFirstPin("");
      setStage("create");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.resetPin(resetToken, entered);
      toast.success(result.message);
      feedback.success();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setShakeToken((token) => token + 1);
      setPinValue("");
      setFirstPin("");
      // The token is single-use in practice — it expires — but a failure here
      // usually means it lapsed while the user was thinking, so send them back
      // to the start rather than letting them retype into a dead token.
      setStage("mobile");
    } finally {
      setBusy(false);
    }
  };

  const heading =
    stage === "mobile"
      ? "Reset your PIN"
      : stage === "code"
        ? "Enter the 6-digit code"
        : stage === "confirm"
          ? "Enter it once more"
          : "Choose a new PIN";

  const subheading =
    stage === "mobile"
      ? "We'll text a one-time code to the number registered with your wallet, then you can choose a new PIN."
      : stage === "code"
        ? `${notice.destinationLabel} ${formatMobile(mobile)}`
        : stage === "confirm"
          ? "Confirm the PIN you just chose so we know it wasn't a typo."
          : "Your old PIN stops working the moment this one is saved.";

  return (
    <AppShell
      header={
        <AppBar
          title="Forgot PIN"
          showBack
          right={<StepDots total={3} current={STAGE_STEP[stage]} />}
          border={false}
        />
      }
      footer={
        stage === "mobile" || stage === "code" ? (
          <div className="shrink-0 border-t border-ink-200 bg-paper-50 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {stage === "mobile" ? (
              <Button
                fullWidth
                size="lg"
                loading={busy}
                disabled={!MOBILE_RE.test(mobile)}
                onClick={() => void requestCode()}
              >
                Send reset code
              </Button>
            ) : (
              <Button
                fullWidth
                size="lg"
                loading={busy}
                disabled={!OTP_RE.test(code)}
                onClick={() => void checkCode()}
              >
                Verify code
              </Button>
            )}
          </div>
        ) : (
          <div className="shrink-0 border-t border-ink-200 bg-paper-50 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <PinPad
              value={pinValue}
              onChange={setPinValue}
              onComplete={(entered) => void choosePin(entered)}
              error={error}
              shakeToken={shakeToken}
              busy={busy}
              busyLabel="Saving your PIN…"
              autoSubmit={!busy}
            />
          </div>
        )
      }
    >
      <div className="px-5 py-5">
        <h2 className="font-display text-[21px] font-bold tracking-tight text-ink-900">
          {heading}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-500">{subheading}</p>

        {stage === "mobile" ? (
          <div className="mt-5">
            <Field label="Registered mobile number" error={error}>
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  data-autofocus
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={mobile}
                  invalid={Boolean(error)}
                  align="center"
                  onChange={(event) =>
                    setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && MOBILE_RE.test(mobile)) void requestCode();
                  }}
                />
              )}
            </Field>

            <Card tone="muted" className="mt-4 flex gap-2.5">
              <IconInfo size={16} className="mt-px shrink-0 text-ink-500" />
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                A PIN can&apos;t be looked up — it is stored as a hash, so nobody can read it
                back, not even us. This is why a forgotten one is replaced rather than
                recovered.
              </p>
            </Card>
          </div>
        ) : null}

        {stage === "code" ? (
          <>
            {notice.previewCode ? (
              <div className="mt-5 flex items-center gap-3 rounded-[10px] border border-dashed border-pending-300 bg-pending-100 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-pending-700">Preview code</p>
                  <p className="text-[13px] text-pending-700">
                    SMS delivery is off in this environment — use{" "}
                    <span className="font-mono font-bold tracking-widest">
                      {notice.previewCode}
                    </span>
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setCode(notice.previewCode ?? "")}>
                  Fill
                </Button>
              </div>
            ) : null}

            <div className="mt-5">
              <Field label="One-time code" error={error}>
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    data-autofocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    invalid={Boolean(error)}
                    align="center"
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && OTP_RE.test(code)) void checkCode();
                    }}
                  />
                )}
              </Field>
            </div>

            <div className="mt-4 flex items-center justify-between px-1">
              <p className="text-[11.5px] text-ink-400">{notice.footnote}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setStage("mobile");
                  setCode("");
                  setError(null);
                }}
                className="shrink-0 text-[12.5px] font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4 disabled:text-ink-400"
              >
                Wrong number?
              </button>
            </div>
          </>
        ) : null}

        {stage === "create" || stage === "confirm" ? (
          <div className="mt-6 space-y-3">
            <Card tone="muted" className="flex gap-2.5">
              <IconWarning size={16} className="mt-px shrink-0 text-pending-600" />
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                Five wrong attempts lock the PIN for 15 minutes, and a new day starts the count
                over — both enforced by the server, not just this screen.
              </p>
            </Card>
            <Card className="flex gap-2.5">
              <IconInfo size={16} className="mt-px shrink-0 text-ink-400" />
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                The code you just verified is the proof: this screen can replace your PIN, and
                it cannot sign in, move money, or see your balance.
              </p>
            </Card>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
