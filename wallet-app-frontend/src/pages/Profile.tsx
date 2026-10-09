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
import { Card, CardTitle, TextLink } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
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

/** "28 minutes" / "1h 5m" — a 30-minute session reads badly as "0h 28m". */
function countdown(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

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
    <Link
      to={to}
      className="flex items-center gap-3 py-3 transition hover:opacity-70 active:opacity-60"
    >
      <IconTile tone="ink" scale="sm">
        {icon}
      </IconTile>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13.5px] font-bold tracking-tight text-ink-900">
          {title}
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-500">{subtitle}</span>
      </span>
      <IconChevronRight size={16} className="shrink-0 text-ink-300" />
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
      {/* Tighter gutter and rhythm than a feed screen: the profile is a card
          index, and the rows should read as one document, not five banners. */}
      <div className="space-y-4 px-4 pt-3.5 pb-6">
        <Card className="flex items-center gap-3.5 p-3.5">
          <Avatar name={profile?.name} size="lg" tone="ink" />
          <div className="min-w-0">
            <p className="truncate font-display text-[17px] font-extrabold tracking-tight text-ink-900">
              {profile?.name ?? "WAULT user"}
            </p>
            <p className="mt-0.5 truncate font-mono text-[12.5px] text-ink-500 tabular-nums">
              {profile?.vpa ?? formatMobile(session?.mobile)}
            </p>
            <Link
              to="/my-qr"
              className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-seal-700 transition hover:text-seal-800"
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
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
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
                className="font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4"
              >
                Not set — add one
              </Link>
            )}
          </DetailRow>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle>Today's sending limit</CardTitle>
            {limits ? (
              <p className="font-display text-[13.5px] font-bold tracking-tight text-ink-900 tabular-nums">
                {formatCurrencyShort(limits.remaining)}{" "}
                <span className="text-[11.5px] font-medium text-ink-400">
                  of {formatCurrencyShort(limits.daily_limit)} left
                </span>
              </p>
            ) : null}
          </div>

          {limits ? (
            <>
              <div className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-paper-200">
                <span
                  className={cx(
                    "block h-full rounded-[3px] transition-all",
                    limits.used_percent >= 90 ? "bg-seal-600" : "bg-ink-900",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, limits.used_percent))}%` }}
                />
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-ink-500">
                {formatCurrency(limits.spent_today)} sent today. The cap is enforced on every
                debit. It resets at midnight IST.
              </p>
            </>
          ) : (
            <p className="mt-2.5 text-[12px] text-ink-400">Checking your limit…</p>
          )}
        </Card>

        <Card padded={false} className="divide-y divide-ink-200/70 px-4">
          <LinkRow
            to="/notifications"
            icon={<IconBell size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />}
            title="Notifications"
            subtitle={
              unreadCount > 0
                ? `${unreadCount} unread — payments, requests and rewards`
                : "Payments, requests and rewards"
            }
          />
          <LinkRow
            to="/accounts"
            icon={<IconWallet size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />}
            title="Linked accounts"
            subtitle="Where your top-ups come from"
          />
          <LinkRow
            to="/contacts"
            icon={<IconUser size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />}
            title="Contacts"
            subtitle="People you pay often"
          />
          <LinkRow
            to="/requests"
            icon={<IconSent size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />}
            title="Requests"
            subtitle="Money you've asked for, and been asked for"
          />
          <LinkRow
            to="/history"
            icon={<IconReceipt size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />}
            title="Transactions"
            subtitle="Every payment and top-up"
          />
        </Card>

        <Card>
          <div className="flex items-start gap-2.5">
            <IconInfo size={16} className="mt-px shrink-0 text-ink-400" />
            <div className="text-[12.5px] leading-relaxed text-ink-600">
              <p className="font-display text-[13px] font-bold tracking-tight text-ink-900">
                Session
              </p>
              {token.expiresAt ? (
                <p className="mt-0.5">
                  Signed in until {formatDateTime(token.expiresAt.toISOString())}
                  {token.minutesLeft !== null
                    ? ` — about ${countdown(token.minutesLeft)} left.`
                    : "."}
                </p>
              ) : (
                <p className="mt-0.5">Signed in.</p>
              )}
              <p className="mt-0.5 text-ink-500">
                Sessions can't be extended, so you sign in again once it ends.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <IconTile tone="ink" scale="sm">
              <IconSound size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[13.5px] font-bold tracking-tight text-ink-900">
                Sounds &amp; haptics
              </p>
              <p className="mt-0.5 text-[12px] text-ink-500">
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
                "relative h-7 w-12 shrink-0 rounded-[6px] ring-1 ring-inset transition focus-visible:ring-2 focus-visible:ring-ink-900/40 focus-visible:outline-none",
                sound ? "bg-ink-900 ring-ink-900" : "bg-paper-200 ring-ink-300",
              )}
            >
              <span
                className={cx(
                  "absolute top-1 size-5 rounded-[4px] transition-all",
                  sound ? "left-6 bg-paper-25" : "left-1 bg-paper-25 ring-1 ring-ink-200",
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
          <CardTitle>About WAULT</CardTitle>
          <ul className="space-y-2 text-[12px] leading-relaxed text-ink-600">
            <li className="flex gap-2">
              <IconWarning size={14} className="mt-0.5 shrink-0 text-seal-600" />
              A portfolio project, not a payment product. There is no NPCI/UPI
              integration and no connection to a real bank.
            </li>
            <li className="flex gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0 text-ink-400" />
              Balances live in WAULT's own database and move only between accounts
              created here.
            </li>
            <li className="flex gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0 text-ink-400" />
              {/* One child, so the line wraps as a sentence instead of breaking
                  into a flex row that cannot fold. */}
              <span className="min-w-0">
                Sample accounts: <span className="font-mono">9000000001</span> and{" "}
                <span className="font-mono">9000000002</span> — PIN{" "}
                <span className="font-mono">1234</span>.
              </span>
            </li>
          </ul>

          {health ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-200 pt-2.5 text-[11.5px] text-ink-500">
              <span>API healthy</span>
              <span aria-hidden="true" className="h-3 w-px bg-ink-200" />
              <span>
                database{" "}
                <span className="font-mono font-semibold text-ink-700">{health.db}</span>
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-ink-200" />
              <span>
                driver{" "}
                <span className="font-mono font-semibold text-ink-700">{health.driver}</span>
              </span>
            </div>
          ) : null}

          <TextLink href={REPO_URL} target="_blank" rel="noreferrer">
            Flask + React source on GitHub
          </TextLink>
        </Card>
      </div>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Sign out of WAULT?"
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
        <p className="text-[13px] leading-relaxed text-ink-600">
          You can sign back in with your mobile number and OTP, or with the one-tap sample
          account.
        </p>
      </Sheet>
    </AppShell>
  );
}
