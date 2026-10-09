import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api, errorMessage } from "../lib/api";
import { formatMobile } from "../lib/format";
import { otpNotice } from "../lib/otp";
import { OTP_RE } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell, AppBar, BrandSeal } from "../components/AppShell";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import { Button } from "../components/ui/Button";
import { IconRefresh, IconSpark } from "../components/ui/Icons";
import { Spinner } from "../components/ui/Spinner";

const OTP_LENGTH = 6;

/**
 * Where the resend deadline is kept between renders of this screen.
 *
 * `location.state` is gone the moment the page is reloaded — the browser keeps a
 * history entry, not its payload — so a refresh would otherwise hand the screen a
 * blank slate and re-enable Resend while the server was still refusing. Writing
 * the same instant to `sessionStorage` is what makes the wait survive a reload,
 * and it is the *server's* instant either way: this screen stores a timestamp, it
 * never invents one.
 */
const RESEND_KEY = "okwault.otpResendAt";

function readStoredDeadline(): number | null {
  try {
    const raw = sessionStorage.getItem(RESEND_KEY);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * When a server-stamped instant falls, in epoch milliseconds.
 *
 * The server is the only clock this screen trusts: it sends back the instant a
 * request may be made again, and everything below counts towards that instant
 * rather than towards a number of seconds the screen decided on. An unreadable
 * or absent stamp means "no wait", which is what the first few requests get.
 */
function deadlineFrom(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const at = Date.parse(stamp);
  return Number.isFinite(at) ? at : null;
}

/**
 * The seconds left on a deadline, recomputed from the clock every tick.
 *
 * Deliberately not a counter: a `setTimeout` chain that decrements is a second
 * clock running beside the server's, and it drifts — it pauses in a background
 * tab, so a phone left on this screen for a minute comes back still saying 45.
 * Subtracting `Date.now()` from the deadline instead means the number shown is
 * always the truth, however long the timer was asleep, and the visibility and
 * focus listeners just make it catch up the moment the screen is looked at
 * again instead of waiting for the next tick.
 */
function useCountdown(deadline: number | null): number {
  const [remaining, setRemaining] = useState(() => secondsLeft(deadline));

  useEffect(() => {
    if (deadline === null) {
      setRemaining(0);
      return;
    }
    const sync = () => setRemaining(secondsLeft(deadline));
    sync();
    const timer = window.setInterval(sync, 1000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [deadline]);

  return remaining;
}

function secondsLeft(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { isAuthenticated, signIn } = useAppSession();

  const routeState = location.state as {
    mobile?: string;
    devOtp?: string | null;
    resendAvailableAt?: string | null;
  } | null;

  const [mobile] = useState(
    () => routeState?.mobile ?? sessionStorage.getItem("okwault.pendingMobile") ?? "",
  );
  const [digits, setDigits] = useState<string[]>(() =>
    Array.from({ length: OTP_LENGTH }, () => ""),
  );
  const [devOtp, setDevOtp] = useState<string | null>(routeState?.devOtp ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The instant the next request may be made, straight from the server. Null
  // while requests are still free, which is why there is no countdown on the
  // first few attempts: there is nothing to count down to.
  const [resendAt, setResendAt] = useState<number | null>(
    () => deadlineFrom(routeState?.resendAvailableAt) ?? readStoredDeadline(),
  );
  const resendIn = useCountdown(resendAt);

  // Keep the stored copy in step, so a reload lands on the same instant this
  // render is counting towards.
  useEffect(() => {
    try {
      if (resendAt === null) sessionStorage.removeItem(RESEND_KEY);
      else sessionStorage.setItem(RESEND_KEY, String(resendAt));
    } catch {
      // Storage is optional; the in-memory deadline still governs this visit.
    }
  }, [resendAt]);

  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const submitted = useRef(false);
  // Only bounce away visitors who were *already* signed in when they landed
  // here — otherwise this guard races the post-verification navigate() and
  // sends brand-new users straight to the wallet, skipping onboarding.
  const wasAuthenticated = useRef(isAuthenticated);
  const code = digits.join("");
  // Delivery-agnostic copy: on-screen now, "sent by SMS" as soon as the server
  // stops returning dev_otp (see lib/otp.ts).
  const notice = otpNotice(devOtp);

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
        // The sign-in is done, so the wait it was tracking is over: clearing the
        // stored deadline means the next visit to this screen starts clean.
        try {
          sessionStorage.removeItem(RESEND_KEY);
        } catch {
          // Storage is optional.
        }
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
    submitted.current = false;
    try {
      const result = await api.startLogin(mobile);
      setDevOtp(result.dev_otp ?? null);
      // Whatever the server says the window is now — none while the free
      // requests last, sixty seconds once they are used up. The screen never
      // sets this itself, which is why a refusal can't leave it counting down
      // from a number that never came from anywhere.
      setResendAt(deadlineFrom(result.resend_available_at));
      toast.success("A new OTP has been sent");
      setDigits(Array.from({ length: OTP_LENGTH }, () => ""));
      inputs.current[0]?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // Refused, and told exactly how long for. The live line under the code
        // reads the countdown, so nothing on screen goes stale while it runs.
        setResendAt(
          deadlineFrom(err.details?.resend_available_at as string | undefined) ??
            Date.now() + (Number(err.details?.retry_after) || 60) * 1000,
        );
      } else {
        setError(errorMessage(err));
      }
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
        <div className="shrink-0 border-t border-ink-200 bg-paper-50 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
      <div className="px-5 pt-5 pb-6">
        {/*
         * A composed head rather than a bare heading. The screen used to open on
         * two lines of type and then a lot of nothing, which is what made it feel
         * unfinished: the mark now sits over it at the top, the code entry is one
         * inked slip instead of six loose boxes, and the resend line has
         * something to hang from. No new facts are introduced — the number, the
         * delivery note and the resend control are the ones that were already
         * here.
         */}
        <div className="flex flex-col items-center border-b border-dashed border-ink-300 pb-5 text-center">
          <span className="flex size-16 items-center justify-center overflow-hidden rounded-[16px] shadow-[3px_3px_0_0_rgba(25,25,22,0.55)]">
            <BrandSeal size={64} />
          </span>
          <h2 className="mt-3.5 font-display text-[21px] font-bold tracking-tight text-ink-900">
            Enter the 6-digit code
          </h2>
          {/* The number and the way out of it are one line, not two: the number
              is what the code was sent to, and "edit" belongs at the end of
              that sentence rather than under it, where it read as a footnote
              instead of the only escape from a wrong number. */}
          <div className="mt-2 flex w-full items-center justify-between gap-3 px-0.5">
            <p className="min-w-0 truncate text-left text-[13.5px] text-ink-500">
              {notice.destinationLabel}{" "}
              <span className="font-mono font-semibold text-ink-700">
                {formatMobile(mobile)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem("okwault.pendingMobile");
                navigate("/login");
              }}
              className="shrink-0 rounded-[7px] border-[1.5px] border-ink-900/25 bg-paper-100 px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 transition hover:border-ink-900/60 hover:bg-paper-200 active:bg-paper-300 focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
            >
              Edit number
            </button>
          </div>
        </div>

        {/* The preview sits a step deeper in the amber than it used to
            (`pending-50`): on a lit phone that cream read as white, which made
            the one panel that is *not* part of the app look like the brightest
            thing on the screen. Same family, one step further in — and the
            Fill control is a warm slip rather than a second ink button, so the
            screen keeps one primary action — the Verify button below. */}
        {notice.previewCode ? (
          <div className="mt-5 flex items-center gap-3 rounded-[10px] border border-dashed border-pending-300 bg-pending-100 p-3.5">
            <IconTile tone="pending" scale="sm">
              <IconSpark size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-pending-700">Preview code</p>
              <p className="text-[13px] text-pending-700">
                SMS delivery is off in this environment — use{" "}
                <span className="font-mono font-bold tracking-widest">
                  {notice.previewCode}
                </span>
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                applyDigits(notice.previewCode ?? "", 0);
                inputs.current[OTP_LENGTH - 1]?.focus();
              }}
            >
              Fill
            </Button>
          </div>
        ) : null}

        {/* The six boxes are one object, not six: an inked slip with the code
            pressed into it, the way the QR code sits in its well on the QR
            screen.

            The slip is a warm `paper-100` mat and the boxes are set on the
            page's own `paper-50` — no step in this stack climbs towards white.
            It used to be the other way round, a `paper-25` slip holding
            `paper-100` wells, and between the brightest sheet in the palette and
            the glow of a lit display the fields read as six white tiles pasted
            onto the theme. The digits were never the problem (ink on cream
            still carries the code at a glance); the paper behind them was. */}
        <div className="mt-5 rounded-[14px] border-[1.5px] border-ink-900/70 bg-paper-100 px-3.5 pt-4 pb-3 shadow-[3px_3px_0_0_rgba(25,25,22,0.55)]">
        <div
          className="flex justify-between gap-2"
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
              className="h-14 w-full min-w-0 rounded-[10px] border-[1.5px] border-ink-900/45 bg-paper-50 text-center font-display text-[22px] font-bold text-ink-900 shadow-[inset_0_1.5px_3px_rgba(15,15,13,0.09)] transition tabular-nums placeholder:text-ink-400 focus:border-ink-900 focus:ring-4 focus:ring-ink-900/12 focus:outline-none disabled:bg-paper-200 disabled:opacity-70 aria-invalid:border-seal-500"
            />
          ))}
        </div>

        <div className="mt-3 flex min-h-6 items-center justify-center" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink-500">
              <Spinner size={14} /> Checking the code…
            </span>
          ) : resendIn > 0 ? (
            <span className="text-[13px] font-medium text-seal-700">
              Please wait {resendIn} seconds before requesting a new OTP.
            </span>
          ) : error ? (
            <span role="alert" className="text-[13px] font-medium text-seal-700">
              {error}
            </span>
          ) : null}
        </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <span className="text-[13px] text-ink-500">Didn't get it?</span>
          <button
            type="button"
            disabled={resendIn > 0 || busy}
            onClick={() => void resend()}
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[13px] font-semibold text-seal-700 transition hover:bg-seal-50 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:bg-transparent"
          >
            <IconRefresh size={14} />
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend OTP"}
          </button>
        </div>

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-ink-400">
          {notice.footnote}
        </p>
      </div>
    </AppShell>
  );
}
