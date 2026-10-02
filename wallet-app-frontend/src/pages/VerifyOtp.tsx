import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { formatMobile } from "../lib/format";
import { OTP_RE } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell, AppBar } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { IconRefresh, IconSpark } from "../components/ui/Icons";
import { Spinner } from "../components/ui/Spinner";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 45;

export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { isAuthenticated, signIn } = useAppSession();

  const routeState = location.state as { mobile?: string; devOtp?: string | null } | null;

  const [mobile] = useState(
    () => routeState?.mobile ?? sessionStorage.getItem("walletpay.pendingMobile") ?? "",
  );
  const [digits, setDigits] = useState<string[]>(() =>
    Array.from({ length: OTP_LENGTH }, () => ""),
  );
  const [devOtp, setDevOtp] = useState<string | null>(routeState?.devOtp ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);

  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const submitted = useRef(false);
  // Only bounce away visitors who were *already* signed in when they landed
  // here — otherwise this guard races the post-verification navigate() and
  // sends brand-new users straight to the wallet, skipping onboarding.
  const wasAuthenticated = useRef(isAuthenticated);
  const code = digits.join("");

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const verify = useCallback(
    async (value: string) => {
      if (!OTP_RE.test(value) || submitted.current) return;
      submitted.current = true;
      setBusy(true);
      setError(null);
      try {
        const data = await api.verifyOtp(mobile, value);
        signIn({
          token: data.token,
          userId: data.user_id,
          mobile,
          name: data.name,
          vpa: data.vpa,
        });
        toast.success(data.message);
        // New users pick a name and a PIN before they can pay anyone.
        navigate(data.ask_name ? "/onboarding/name" : "/home", { replace: true });
      } catch (err) {
        setError(errorMessage(err));
        setDigits(Array.from({ length: OTP_LENGTH }, () => ""));
        inputs.current[0]?.focus();
        submitted.current = false;
      } finally {
        setBusy(false);
      }
    },
    [mobile, navigate, signIn, toast],
  );

  // Submit as soon as the sixth digit lands.
  useEffect(() => {
    if (code.length === OTP_LENGTH) void verify(code);
  }, [code, verify]);

  const resend = async () => {
    setError(null);
    setResendIn(RESEND_SECONDS);
    submitted.current = false;
    try {
      const result = await api.startLogin(mobile);
      setDevOtp(result.dev_otp ?? null);
      toast.success("A new OTP has been sent");
      setDigits(Array.from({ length: OTP_LENGTH }, () => ""));
      inputs.current[0]?.focus();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const applyDigits = (value: string, startIndex: number) => {
    const numbers = value.replace(/\D/g, "");
    if (!numbers) return;
    setDigits((current) => {
      const next = [...current];
      for (let i = 0; i < numbers.length && startIndex + i < OTP_LENGTH; i += 1) {
        next[startIndex + i] = numbers[i];
      }
      return next;
    });
    const focusAt = Math.min(startIndex + numbers.length, OTP_LENGTH - 1);
    inputs.current[focusAt]?.focus();
  };

  if (!mobile) return <Navigate to="/login" replace />;
  if (wasAuthenticated.current) return <Navigate to="/home" replace />;

  return (
    <AppShell
      header={<AppBar title="Verify your number" showBack />}
      footer={
        <div className="shrink-0 border-t border-slate-100 bg-white px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            fullWidth
            size="lg"
            loading={busy}
            disabled={!OTP_RE.test(code)}
            onClick={() => void verify(code)}
          >
            Verify &amp; continue
          </Button>
        </div>
      }
    >
      <div className="px-5 py-6">
        <h2 className="text-[20px] font-bold tracking-tight text-slate-900">
          Enter the 6-digit code
        </h2>
        <p className="mt-1.5 text-[13.5px] text-slate-500">
          Sent to{" "}
          <span className="font-semibold text-slate-700 tabular-nums">
            {formatMobile(mobile)}
          </span>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem("walletpay.pendingMobile");
              navigate("/login");
            }}
            className="ml-2 font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2"
          >
            Edit
          </button>
        </p>

        {devOtp ? (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <IconSpark size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold tracking-wide text-amber-800 uppercase">
                Preview code
              </p>
              <p className="text-[13px] text-amber-900">
                SMS delivery is off in this environment — use{" "}
                <span className="font-mono font-bold tracking-widest">{devOtp}</span>
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                applyDigits(devOtp, 0);
                inputs.current[OTP_LENGTH - 1]?.focus();
              }}
            >
              Fill
            </Button>
          </div>
        ) : null}

        <div
          className="mt-6 flex justify-between gap-2"
          onPaste={(event) => {
            event.preventDefault();
            applyDigits(event.clipboardData.getData("text"), 0);
          }}
        >
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              value={digit}
              inputMode="numeric"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={1}
              aria-label={`OTP digit ${index + 1}`}
              disabled={busy}
              autoFocus={index === 0}
              onChange={(event) => applyDigits(event.target.value, index)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && !digits[index] && index > 0) {
                  inputs.current[index - 1]?.focus();
                  setDigits((current) => {
                    const next = [...current];
                    next[index - 1] = "";
                    return next;
                  });
                  event.preventDefault();
                  return;
                }
                if (event.key === "ArrowLeft" && index > 0) {
                  inputs.current[index - 1]?.focus();
                }
                if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
                  inputs.current[index + 1]?.focus();
                }
              }}
              className="h-14 w-full min-w-0 rounded-xl border border-slate-200 bg-white text-center text-[22px] font-bold text-slate-900 shadow-xs transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none disabled:bg-slate-50 aria-invalid:border-rose-300"
            />
          ))}
        </div>

        <div className="mt-4 flex min-h-6 items-center justify-center" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-500">
              <Spinner size={14} /> Checking the code…
            </span>
          ) : error ? (
            <span role="alert" className="text-[13px] font-medium text-rose-600">
              {error}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <span className="text-[13px] text-slate-500">Didn't get it?</span>
          <button
            type="button"
            disabled={resendIn > 0}
            onClick={() => void resend()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
          >
            <IconRefresh size={14} />
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend OTP"}
          </button>
        </div>

        <p className="mt-8 text-center text-[11.5px] leading-relaxed text-slate-400">
          Codes normally arrive by SMS. Without an SMS gateway configured, this
          environment returns the code in the API response instead — and after three wrong
          attempts you'll need a fresh one.
        </p>
      </div>
    </AppShell>
  );
}
