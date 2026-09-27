import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { MOBILE_RE, mobileError } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell, BrandMark } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { Field, TextInput } from "../components/ui/Field";
import { IconPhone, IconSpark, IconWarning } from "../components/ui/Icons";

const DEMO_MOBILE = "9000000001";
const DEMO_PIN = "1234";
const REPO_URL = "https://github.com/ashutosh250604/upi-wallet-app";

export default function LoginPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, signIn } = useAppSession();

  const [mobile, setMobile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState<boolean | null>(null);
  const [asleep, setAsleep] = useState(false);

  // Render's free tier sleeps, so the first request can take ~30s. Warn early.
  useEffect(() => {
    const timer = window.setTimeout(() => setAsleep(true), 3500);
    const controller = new AbortController();
    void (async () => {
      try {
        const health = await api.health(controller.signal);
        setDemoAvailable(health.demo_mode);
      } catch {
        setDemoAvailable(false);
      } finally {
        window.clearTimeout(timer);
        setAsleep(false);
      }
    })();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  // Captured once: signing in during this render must not pre-empt the
  // explicit navigation that follows it.
  const wasAuthenticated = useRef(isAuthenticated);
  if (wasAuthenticated.current) return <Navigate to="/home" replace />;

  const submit = async () => {
    const problem = mobileError(mobile);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await api.startLogin(mobile);
      sessionStorage.setItem("pocketpay.pendingMobile", mobile);
      navigate("/verify-otp", {
        state: { mobile, devOtp: result.dev_otp ?? null },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async () => {
    setError(null);
    setDemoBusy(true);
    try {
      const data = await api.demoLogin();
      signIn({
        token: data.token,
        userId: data.user_id,
        mobile: data.mobile,
        name: data.name,
        vpa: data.vpa,
      });
      toast.success(`Signed in as ${data.name ?? "the demo user"}`);
      navigate("/home", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <AppShell>
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-600 to-fuchsia-600 px-6 pt-10 pb-14 text-white">
        <span className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -bottom-20 -left-12 size-52 rounded-full bg-white/5" />
        <div className="relative">
          <BrandMark />
          <h1 className="mt-7 text-[26px] leading-tight font-bold tracking-tight">
            Send money the
            <br />
            UPI way.
          </h1>
          <p className="mt-2 max-w-[19rem] text-[13.5px] leading-relaxed text-white/80">
            Sign in with your mobile number, set a 4-digit PIN, and pay anyone by
            their <span className="font-semibold text-white">@demoupi</span> handle or QR
            code.
          </p>
        </div>
      </div>

      <div className="space-y-5 px-5 py-6">
        <Card className="-mt-11 shadow-lg shadow-slate-900/5">
          <div className="space-y-4">
            <Field
              label="Mobile number"
              error={error}
              hint="We'll send a 6-digit OTP to verify it's you."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  prefix="+91"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  autoFocus
                  maxLength={10}
                  placeholder="98765 43210"
                  className="tracking-wide"
                  value={mobile}
                  invalid={Boolean(error)}
                  onChange={(event) =>
                    setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && MOBILE_RE.test(mobile)) void submit();
                  }}
                />
              )}
            </Field>

            <Button
              fullWidth
              size="lg"
              loading={busy}
              disabled={!MOBILE_RE.test(mobile)}
              onClick={() => void submit()}
              leftIcon={<IconPhone size={18} />}
            >
              Get OTP
            </Button>

            {asleep ? (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12.5px] text-amber-800">
                <IconWarning size={15} className="mt-px shrink-0" />
                The free demo server may be waking up — the first request can take up
                to 30 seconds.
              </p>
            ) : null}
          </div>
        </Card>

        {demoAvailable ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11.5px] font-semibold tracking-wider text-slate-400 uppercase">
                or
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <Button
              variant="secondary"
              fullWidth
              size="lg"
              loading={demoBusy}
              onClick={() => void demoLogin()}
              leftIcon={<IconSpark size={18} className="text-brand-600" />}
            >
              Explore with the demo account
            </Button>

            <Card tone="muted" className="text-[12.5px] text-slate-600">
              <p className="font-semibold text-slate-700">Demo credentials</p>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    Mobile <span className="font-mono font-semibold">{DEMO_MOBILE}</span>
                  </span>
                  <CopyButton
                    value={DEMO_MOBILE}
                    label="Copy demo mobile number"
                    size={14}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>
                    PIN <span className="font-mono font-semibold">{DEMO_PIN}</span>
                  </span>
                  <CopyButton value={DEMO_PIN} label="Copy demo PIN" size={14} />
                </div>
                <p className="pt-1 text-slate-500">
                  Second account to pay:{" "}
                  <span className="font-mono font-semibold">9000000002@demoupi</span>
                </p>
              </div>
            </Card>
          </div>
        ) : null}

        <p className="px-1 text-center text-[11.5px] leading-relaxed text-slate-500">
          PocketPay is a portfolio demo. There is no NPCI/UPI integration, no real
          payment rail and no real money — balances only move inside this app's own
          database.{" "}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2"
          >
            Source on GitHub
          </a>
        </p>
      </div>
    </AppShell>
  );
}
