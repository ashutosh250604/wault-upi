import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatCurrency, formatDateTime, formatMobile } from "../lib/format";
import { inspectToken } from "../lib/session";
import type { HealthResponse } from "../types";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { DetailRow } from "../components/ui/DetailRow";
import { Sheet } from "../components/ui/Sheet";
import { IconInfo, IconLogout, IconQr, IconWarning } from "../components/ui/Icons";

const REPO_URL = "https://github.com/ashutosh250604/upi-wallet-app";

export default function ProfilePage() {
  const { session, profile, signOut } = useAppSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);

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

  const token = inspectToken(session?.token ?? null);

  return (
    <AppShell nav header={<AppBar title="Profile" />}>
      <div className="space-y-5 px-5 pt-4 pb-6">
        <Card className="flex items-center gap-4">
          <Avatar name={profile?.name} size="xl" tone="gradient" />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold tracking-tight text-slate-900">
              {profile?.name ?? "PocketPay user"}
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
          <p className="text-[13px] font-semibold text-slate-700">About this demo</p>
          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-slate-600">
            <li className="flex gap-2">
              <IconWarning size={14} className="mt-0.5 shrink-0 text-amber-500" />
              A portfolio project, not a payment product. No NPCI/UPI integration, no bank
              rails, no real money.
            </li>
            <li className="flex gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0 text-slate-400" />
              Balances live in this app's own database and only move between accounts
              created here.
            </li>
            <li className="flex gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0 text-slate-400" />
              Seeded accounts: <span className="font-mono">9000000001</span> and{" "}
              <span className="font-mono">9000000002</span> — PIN{" "}
              <span className="font-mono">1234</span>.
            </li>
          </ul>

          {health ? (
            <p className="border-t border-slate-200/70 pt-2.5 text-[11.5px] text-slate-500">
              API healthy · database{" "}
              <span className="font-mono font-semibold">{health.db}</span> · driver{" "}
              <span className="font-mono font-semibold">{health.driver}</span>
              {health.demo_mode ? " · demo mode on" : ""}
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
        title="Sign out of PocketPay?"
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
          You can sign back in with your mobile number and OTP, or with the one-tap demo
          account.
        </p>
      </Sheet>
    </AppShell>
  );
}
