import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { MOBILE_RE, mobileError } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppShell, BrandMark, BrandMarkImage } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { Field } from "../components/ui/Field";
import { IconPhone, IconSpark, IconWarning } from "../components/ui/Icons";

const SAMPLE_MOBILE = "9000000001";
const SAMPLE_PIN = "1234";
// The second seeded user, so a visitor can pay a real counterparty immediately.
const SAMPLE_PAYEE = "9000000002@okwault";
const REPO_URL = "https://github.com/ashutosh250604/upi-wallet-app";

export default function LoginPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, signIn } = useAppSession();

  const [mobile, setMobile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleAccount, setSampleAccount] = useState(false);
  const [asleep, setAsleep] = useState(false);

  // The free tier sleeps, so the first request can take ~30s. Warn early.
  useEffect(() => {
    const timer = window.setTimeout(() => setAsleep(true), 3500);
    const controller = new AbortController();
    void (async () => {
      try {
        const health = await api.health(controller.signal);
        setSampleAccount(health.demo_mode);
      } catch {
        setSampleAccount(false);
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
      sessionStorage.setItem("okwault.pendingMobile", mobile);
      navigate("/verify-otp", {
        state: {
          mobile,
          devOtp: result.dev_otp ?? null,
          // The verify screen counts its resend window down from the server's
          // own instant rather than from a number it made up — see the note on
          // `resend_available_at` in lib/api.ts.
          resendAvailableAt: result.resend_available_at ?? null,
        },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const signInToSample = async () => {
    setError(null);
    setSampleBusy(true);
    try {
      const data = await api.sampleLogin();
      signIn({
        token: data.token,
        userId: data.user_id,
        mobile: data.mobile,
        name: data.name,
        vpa: data.vpa,
      });
      toast.success(`Welcome, ${data.name ?? "there"}!`);
      navigate("/home", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSampleBusy(false);
    }
  };

  return (
    <AppShell contentClassName="overflow-hidden">
      {/*
       * Cover: a wallet card rather than a banner. The brand mark, the promise
       * and the three facts are printed on one object, with the rupee seal
       * tipped into its corner like a watermark instead of floating loose behind
       * the page.
       *
       * The card centres in whatever height is left after the form; the form
       * scrolls internally only as a last resort (tiny screens, or a mobile
       * keyboard eating half the viewport) so the primary action is never pushed
       * off-screen.
       */}
      <div className="flex h-full flex-col">
        {/*
         * The card is the page's one flexible block: it takes exactly the height
         * the form leaves it, no more and no less. It used to be capped at 28rem
         * and given a 15rem floor inside a scroll container, which is what made
         * a tall screen hand the cover a scrollbar and a short one hide the
         * card's own head. Now it simply fits — the form is fixed-height, this
         * is `flex-1`, and the facts row pinned to the card's bottom edge turns
         * the slack a tall screen leaves into part of the design.
         *
         * Below the floor a very short viewport would otherwise squeeze, the
         * card clips its overflow rather than scrolling: half a cover is still a
         * cover, and the form underneath is what the screen is for.
         *
         * The one thing that must never be *cut*, only dropped, is the card's
         * own copy. Clipping leaves a row of half-height words that reads as a
         * rendering fault; hiding it leaves a cover that is simply quieter on a
         * short screen and complete on a tall one. So the card sheds its parts
         * in order of how much they matter — facts row first (`45rem`), then
         * the sign-in sentence (`41rem`) — and what is left at the bottom of the
         * range is the mark and the promise, which is a cover.
         *
         * Measured against the *viewport* rather than the card because the card
         * is exactly what the fixed-height form leaves it: the two are the same
         * fact, and a media query costs no observers to watch it.
         */}
        <div className="min-h-0 flex-1 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3.5">
          <div className="flex h-full flex-col">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] bg-ink-900 px-5 pt-5 pb-6 text-ink-25 shadow-[0_30px_60px_-34px_rgba(15,15,13,0.95)]">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-20 -left-16 size-40 rounded-full bg-ink-800/80"
              />
              {/* The real mark, blown up and tipped into the corner at low
                  opacity: the same file the QR code is stamped with, so the
                  first screen anyone sees carries the logo itself rather than a
                  crop of it. Sized to the corner it decorates — big enough to
                  read as the artwork, cropped by the card rather than floating
                  inside it. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-9 -right-14 rotate-[14deg] opacity-[0.22]"
              >
                <BrandMarkImage size={170} />
              </span>

              {/* The lockup, at the size the screen can carry: the seal and the
                  name share a baseline and there is no tagline under them, so
                  the logo is the first thing read rather than the smallest. */}
              <div className="relative">
                <BrandMark invert sealSize={44} wordClassName="text-[28px]" className="gap-3" />
              </div>

              <h1 className="relative mt-6 font-display text-[1.7rem] leading-[1.06] font-extrabold tracking-[-0.03em]">
                Pay anyone by
                <br />
                UPI ID or QR.
              </h1>
              <p className="relative mt-2 max-w-[19rem] text-[13px] leading-relaxed text-ink-300 [@media(max-height:41rem)]:hidden">
                Sign in with your mobile number, then pay any{" "}
                <span className="font-mono text-ink-100">@okwault</span> handle or QR
                code.
              </p>
              {/* One sentence rather than three chips with rules between them.
                  The old row set "OTP sign-in", "4-digit payment PIN" and
                  "30-minute sessions" as a row of labels, with the brand seal
                  in front of the last one — a logo used as punctuation, and a
                  list where the screen wanted a promise. It says the same three
                  things the way a person would. */}
              <p className="relative mt-auto pt-5 text-[12.5px] leading-relaxed text-ink-400 [@media(max-height:45rem)]:hidden">
                Sign in with an OTP, pay with a 4-digit PIN, and your session lasts 30
                minutes.
              </p>
            </div>
          </div>
        </div>

        {/* Paper form, pinned to the bottom edge of the frame. The gap above it
            is a fixed, small rhythm rather than a leftover — the hero is what
            absorbs a tall screen.

            Neither this block nor the cover above it scrolls. They used to:
            both were `overflow-y-auto`, which put a second, visible scrollbar
            inside the phone frame and let the cover slide under its own
            heading. The cover is now the only flexible thing on the page — it
            shrinks to nothing when the keyboard takes half the viewport, and
            the form is exactly as tall as its contents, so there is nothing to
            scroll and no bar to hide. */}
        <div className="shrink-0 bg-paper-50 px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="space-y-2.5">
            <Field
              label="Mobile number"
              error={error}
              hint="We'll send a 6-digit OTP to verify it's you."
            >
              {({ id, describedBy }) => (
                /* The country code is a printed slug, not a floating hint, and
                   the number is set in the ledger face — the one field on the
                   screen that is unmistakably part of the app's paper. */
                <div
                  className={cx(
                    "flex h-12 items-stretch overflow-hidden rounded-[10px] border-[1.5px] bg-paper-100 transition",
                    error
                      ? "border-seal-500 shadow-[inset_0_1.5px_3px_rgba(82,25,18,0.09)] focus-within:border-seal-600 focus-within:ring-4 focus-within:ring-seal-500/20"
                      : "border-ink-900/80 shadow-[inset_0_1.5px_3px_rgba(15,15,13,0.07)] focus-within:border-ink-900 focus-within:ring-4 focus-within:ring-ink-900/10",
                  )}
                >
                  <span className="flex shrink-0 items-center px-3 font-mono text-[14.5px] font-semibold text-ink-600 select-none">
                    +91
                  </span>
                  <span aria-hidden="true" className="my-2.5 w-px shrink-0 bg-ink-900/25" />
                  {/* An empty field must not look like a filled one: the
                      placeholder is set in a lighter ink and a lighter weight,
                      so an entered number (ink-900, semibold) is unmistakably
                      the darker of the two. */}
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={Boolean(error) || undefined}
                    inputMode="numeric"
                    autoComplete="tel-national"
                    autoFocus
                    maxLength={10}
                    placeholder="98765 43210"
                    value={mobile}
                    onChange={(event) =>
                      setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && MOBILE_RE.test(mobile)) void submit();
                    }}
                    className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[16px] font-semibold tracking-[0.04em] text-ink-900 tabular-nums placeholder:font-medium placeholder:text-ink-400 focus:outline-none"
                  />
                </div>
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

            {/* The PIN is the one credential a hash cannot give back. Without
                this door a forgotten PIN left the wallet unusable for good, so
                it belongs beside the way in rather than buried in help. */}
            <div className="flex justify-end">
              <Link
                to="/forgot-pin"
                className="rounded-[6px] px-1 py-0.5 text-[12.5px] font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4 transition hover:text-seal-800 focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
              >
                Forgot your PIN?
              </Link>
            </div>

            {asleep ? (
              <p className="flex items-start gap-2 rounded-[10px] bg-pending-50 p-3 text-[12.5px] leading-relaxed text-pending-700 ring-1 ring-pending-100 ring-inset">
                <IconWarning size={15} className="mt-px shrink-0" />
                Still connecting — the server may be waking up, so the first request
                can take up to 30 seconds.
              </p>
            ) : null}
          </div>

        {sampleAccount ? (
          <div className="mt-2.5 space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="border-t border-dashed border-ink-300 flex-1" />
              <span className="text-[12px] font-medium text-ink-500">or</span>
              <span className="border-t border-dashed border-ink-300 flex-1" />
            </div>

            <Button
              variant="ticket"
              fullWidth
              size="lg"
              loading={sampleBusy}
              onClick={() => void signInToSample()}
              leftIcon={<IconSpark size={18} className="text-seal-600" />}
            >
              Explore with a ready-made account
            </Button>

            {/* Same facts as before, packed into two tight lines: the demo
                affordance must stay honest without owning the fold. */}
            <Card tone="muted" className="space-y-1.5 p-2.5 text-[11.5px] text-ink-600">
              <div className="flex items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    Mobile{" "}
                    <span className="font-mono font-semibold text-ink-800">{SAMPLE_MOBILE}</span>
                  </span>
                  <span aria-hidden="true" className="h-3 w-px bg-ink-300" />
                  <span>
                    PIN <span className="font-mono font-semibold text-ink-800">{SAMPLE_PIN}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  <CopyButton value={SAMPLE_MOBILE} label="Copy mobile number" size={13} />
                  <CopyButton value={SAMPLE_PIN} label="Copy PIN" size={13} />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-dashed border-ink-200 pt-2">
                <span className="text-ink-500">
                  Someone to pay:{" "}
                  <span className="font-mono font-semibold text-ink-700">{SAMPLE_PAYEE}</span>
                </span>
                <CopyButton value={SAMPLE_PAYEE} label="Copy UPI ID" size={13} />
              </div>
            </Card>
          </div>
        ) : null}

          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-ink-500">
            WAULT is an open-source portfolio project — Flask, React and PostgreSQL.{" "}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4"
            >
              Source on GitHub
            </a>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
