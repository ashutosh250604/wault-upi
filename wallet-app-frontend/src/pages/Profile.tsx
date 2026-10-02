import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { feedback, isFeedbackEnabled, setFeedbackEnabled } from "../lib/feedback";
import {
  formatCurrency,
  formatCurrencyShort,
  formatDateTime,
  formatMobile,
} from "../lib/format";
import { inspectToken } from "../lib/session";
import type { HealthResponse, LimitsResponse } from "../types";
import { useAppSession } from "../session/context";
import { useNotifications } from "../hooks/useNotifications";
import { AppBar, AppShell } from "../components/AppShell";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { Sheet } from "../components/ui/Sheet";
import {
  IconBell,
  IconChevronRight,
  IconInfo,
  IconLogout,
  IconQr,
  IconReceipt,
  IconSent,
  IconSound,
  IconUser,
  IconWallet,
  IconWarning,
} from "../components/ui/Icons";

const REPO_URL = "https://github.com/ashutosh250604/upi-wallet-app";

/** A plain navigation row, so the profile screen can point at the deeper screens. */
function LinkRow({
  to,
  icon,
  title,
  subtitle,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 py-3.5 transition hover:opacity-80">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-slate-800">{title}</span>
        <span className="block text-[12px] text-slate-500">{subtitle}</span>
      </span>
      <IconChevronRight size={16} className="shrink-0 text-slate-300" />
    </Link>
  );
}

export default function ProfilePage() {
  const { session, profile, signOut } = useAppSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [limits, setLimits] = useState<LimitsResponse | null>(null);
  const [sound, setSound] = useState(isFeedbackEnabled);
  const { unreadCount } = useNotifications();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setHealth(await api.health(controller.signal));
      } catch {
        setHealth(null);
      }
    })();
    return () => controller.abort();
  }, []);

  // The cap the ledger enforces, read from the endpoint the ledger itself uses
  // rather than recomputed here — a limit shown must be a limit applied.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setLimits(await api.limits(controller.signal));
      } catch {
        setLimits(null);
      }
    })();
    return () => controller.abort();
  }, [profile?.balance]);

  const token = inspectToken(session?.token ?? null);

  return (
    <AppShell nav header={<AppBar title="Profile" />}>
      <div className="space-y-5 px-5 pt-4 pb-6">
        <Card className="flex items-center gap-4">
          <Avatar name={profile?.name} size="xl" tone="gradient" />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold tracking-tight text-slate-900">
              {profile?.name ?? "Wallet Pay user"}
            </p>
            <p className="truncate text-[13px] text-slate-500 tabular-nums">
              {profile?.vpa ?? formatMobile(session?.mobile)}
            </p>
            <Link
              to="/my-qr"
              className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-700"
            >
              <IconQr size={14} /> Show my QR
            </Link>
          </div>
        </Card>

        <Card padded={false} className="px-4">
          <DetailRow label="Balance">
            <span className="tabular-nums">{formatCurrency(profile?.balance ?? 0)}</span>
          </DetailRow>
          <DetailRow label="Mobile">
            <span className="tabular-nums">{formatMobile(profile?.mobile)}</span>
          </DetailRow>
          <DetailRow label="UPI ID">
            {profile?.vpa ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                {profile.vpa}
                <CopyButton value={profile.vpa} label="Copy UPI ID" size={14} />
              </span>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label="Verified">{profile?.is_verified ? "Yes" : "No"}</DetailRow>
          <DetailRow label="Payment PIN">
            {profile?.has_pin ? (
              "Set"
            ) : (
              <Link
                to="/onboarding/pin"
                className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2"
              >
                Not set — add one
              </Link>
            )}
          </DetailRow>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13.5px] font-semibold text-slate-800">Today's sending limit</p>
            {limits ? (
              <p className="text-[13px] font-bold text-slate-900 tabular-nums">
                {formatCurrencyShort(limits.remaining)}{" "}
                <span className="text-[11.5px] font-medium text-slate-400">
                  of {formatCurrencyShort(limits.daily_limit)} left
                </span>
              </p>
            ) : null}
          </div>

          {limits ? (
            <>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <span
                  className={cx(
                    "block h-full rounded-full transition-all",
                    limits.used_percent >= 90 ? "bg-rose-500" : "bg-brand-500",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, limits.used_percent))}%` }}
                />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
                {formatCurrency(limits.spent_today)} sent today. The cap is enforced on every
                debit, not just shown here, and it resets at midnight.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12px] text-slate-400">Checking your limit…</p>
          )}
        </Card>

        <Card padded={false} className="divide-y divide-slate-100 px-4">
          <LinkRow
            to="/notifications"
            icon={<IconBell size={17} />}
            title="Notifications"
            subtitle={
              unreadCount > 0
                ? `${unreadCount} unread — payments, requests and cashback`
                : "Payments, requests and cashback"
            }
          />
          <LinkRow
            to="/accounts"
            icon={<IconWallet size={17} />}
            title="Linked accounts"
            subtitle="Where your top-ups come from"
          />
          <LinkRow
            to="/contacts"
            icon={<IconUser size={17} />}
            title="Contacts"
            subtitle="People you pay often"
          />
          <LinkRow
            to="/requests"
            icon={<IconSent size={17} />}
            title="Requests"
            subtitle="Money you've asked for, and been asked for"
          />
          <LinkRow
            to="/history"
            icon={<IconReceipt size={17} />}
            title="Transactions"
            subtitle="Every payment and top-up"
          />
        </Card>

        <Card>
          <div className="flex items-start gap-2.5">
            <IconInfo size={16} className="mt-px shrink-0 text-slate-400" />
            <div className="text-[12.5px] leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-700">Session</p>
              {token.expiresAt ? (
                <p className="mt-0.5">
                  Your token expires {formatDateTime(token.expiresAt.toISOString())}
                  {token.minutesLeft !== null
                    ? ` — about ${Math.floor(token.minutesLeft / 60)}h ${token.minutesLeft % 60}m left.`
                    : "."}
                </p>
              ) : (
                <p className="mt-0.5">Signed in with a JSON Web Token.</p>
              )}
              <p className="mt-0.5 text-slate-500">
                A 401 from any call signs you out automatically instead of leaving the
                screen half-broken.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <IconSound size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-slate-800">
                Sounds &amp; haptics
              </p>
              <p className="text-[12px] text-slate-500">
                Keypad ticks, a chime when money moves, a buzz on errors.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sound}
              aria-label="Sounds and haptics"
              onClick={() => {
                const next = !sound;
                setSound(next);
                setFeedbackEnabled(next);
                if (next) feedback.success();
              }}
              className={cx(
                "relative h-7 w-12 shrink-0 rounded-full transition",
                sound ? "bg-brand-600" : "bg-slate-200",
              )}
            >
              <span
                className={cx(
                  "absolute top-1 size-5 rounded-full bg-white shadow transition-all",
                  sound ? "left-6" : "left-1",
                )}
              />
            </button>
          </div>
        </Card>

        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => setConfirmOpen(true)}
          leftIcon={<IconLogout size={17} />}
        >
          Sign out
        </Button>

        <Card tone="muted" className="space-y-3">
          <p className="text-[13px] font-semibold text-slate-700">About Wallet Pay</p>
          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-slate-600">
            <li className="flex gap-2">
              <IconWarning size={14} className="mt-0.5 shrink-0 text-amber-500" />
              A portfolio project, not a payment product. There is no NPCI/UPI
              integration and no connection to a real bank.
            </li>
            <li className="flex gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0 text-slate-400" />
              Balances live in Wallet Pay's own database and move only between accounts
              created here.
            </li>
            <li className="flex gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0 text-slate-400" />
              Sample accounts: <span className="font-mono">9000000001</span> and{" "}
              <span className="font-mono">9000000002</span> — PIN{" "}
              <span className="font-mono">1234</span>.
            </li>
          </ul>

          {health ? (
            <p className="border-t border-slate-200/70 pt-2.5 text-[11.5px] text-slate-500">
              API healthy · database{" "}
              <span className="font-mono font-semibold">{health.db}</span> · driver{" "}
              <span className="font-mono font-semibold">{health.driver}</span>

            </p>
          ) : null}

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[12.5px] font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2"
          >
            Flask + React source on GitHub →
          </a>
        </Card>
      </div>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Sign out of Wallet Pay?"
        description="Your session token will be discarded on this device. Balances stay untouched."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              fullWidth
              onClick={() => {
                setConfirmOpen(false);
                signOut("Signed out");
              }}
            >
              Sign out
            </Button>
          </div>
        }
      >
        <p className="text-[13px] leading-relaxed text-slate-600">
          You can sign back in with your mobile number and OTP, or with the one-tap sample
          account.
        </p>
      </Sheet>
    </AppShell>
  );
}
