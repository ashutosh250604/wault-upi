import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WalletTransaction } from "../types";
import { firstName } from "../lib/format";
import { useAppSession } from "../session/context";
import { AppBar, AppShell, BrandMark } from "../components/AppShell";
import { BalanceCard } from "../components/BalanceCard";
import { TransactionDetailSheet, TransactionList } from "../components/Transactions";
import { Avatar } from "../components/ui/Avatar";
import { Card } from "../components/ui/Card";
import { ErrorState } from "../components/ui/States";
import { Button } from "../components/ui/Button";
import {
  IconClose,
  IconLock,
  IconPlus,
  IconQr,
  IconReceipt,
  IconScan,
  IconSpark,
} from "../components/ui/Icons";

const TIP_KEY = "pocketpay.tipDismissed";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function QuickAction({
  to,
  label,
  Icon,
  tone,
  state,
}: {
  to: string;
  label: string;
  Icon: (props: { size?: number }) => React.ReactNode;
  tone: string;
  state?: unknown;
}) {
  return (
    <Link
      to={to}
      state={state}
      className="group flex flex-col items-center gap-2 rounded-2xl px-1 py-3 transition hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <span className={`flex size-12 items-center justify-center rounded-2xl ${tone}`}>
        <Icon size={21} />
      </span>
      <span className="text-center text-[11.5px] leading-tight font-semibold text-slate-600">
        {label}
      </span>
    </Link>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { userId, session, profile, transactions, status, error, refresh } = useAppSession();
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<WalletTransaction | null>(null);
  const [tipDismissed, setTipDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(TIP_KEY) === "1";
    } catch {
      return false;
    }
  });

  const loading = status === "loading" && profile === null;
  // Fall back to the session name until /me lands, so a just-onboarded user
  // isn't greeted as a stranger for a frame.
  const displayName = profile?.name ?? session?.name ?? null;
  const needsPin = profile !== null && !profile.has_pin;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh({ silent: true });
    setRefreshing(false);
  };

  const dismissTip = () => {
    setTipDismissed(true);
    try {
      window.localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Non-critical.
    }
  };

  return (
    <AppShell
      nav
      header={
        <AppBar
          border={false}
          right={
            <Link
              to="/profile"
              aria-label="Open profile"
              className="rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              <Avatar name={displayName} size="md" tone="gradient" />
            </Link>
          }
        >
          <BrandMark />
        </AppBar>
      }
    >
      <div className="space-y-6 px-5 pt-1 pb-6">
        <div>
          <div className="mb-3 px-1">
            <p className="text-[15px] font-semibold tracking-tight text-slate-900">
              {greeting()}, {firstName(displayName)}
            </p>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              Here's how your wallet is doing today.
            </p>
          </div>
          <BalanceCard
            balance={profile?.balance ?? null}
            vpa={profile?.vpa ?? null}
            loading={loading}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
          />
        </div>

        {needsPin ? (
          <Card className="space-y-3 bg-amber-50 ring-1 ring-amber-200">
            <div className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
                <IconLock size={17} />
              </span>
              <div>
                <p className="text-[13.5px] font-semibold text-amber-900">
                  Set your PIN to start paying
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-900/70">
                  Your account was created but the 4-digit PIN step was never
                  finished, so payments can't be approved yet.
                </p>
              </div>
            </div>
            <Button size="sm" fullWidth onClick={() => navigate("/onboarding/pin")}>
              Set my PIN
            </Button>
          </Card>
        ) : null}

        <div className="grid grid-cols-4 gap-1 rounded-3xl border border-slate-100 bg-white p-1.5 shadow-sm">
          <QuickAction
            to="/scan"
            label="Scan & pay"
            Icon={IconScan}
            tone="bg-brand-50 text-brand-600"
          />
          <QuickAction to="/my-qr" label="My QR" Icon={IconQr} tone="bg-fuchsia-50 text-fuchsia-600" />
          <QuickAction
            to="/pay/amount"
            label="Add money"
            Icon={IconPlus}
            tone="bg-emerald-50 text-emerald-600"
            state={{ mode: "topup" }}
          />
          <QuickAction
            to="/history"
            label="History"
            Icon={IconReceipt}
            tone="bg-slate-100 text-slate-600"
          />
        </div>

        {status === "error" && profile === null ? (
          <Card>
            <ErrorState message={error ?? "We couldn't load your wallet."} onRetry={() => void onRefresh()} />
          </Card>
        ) : null}

        {!tipDismissed ? (
          <Card className="flex gap-3 bg-gradient-to-br from-brand-50 to-fuchsia-50/60 ring-1 ring-brand-100">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
              <IconSpark size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-brand-900">
                Try a real transfer
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-brand-900/70">
                Pay <span className="font-mono font-semibold">9000000002@demoupi</span>{" "}
                (Meera Iyer) and approve it with PIN <span className="font-mono font-semibold">1234</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissTip}
              aria-label="Dismiss tip"
              className="-mt-1 -mr-1 h-fit rounded-full p-1.5 text-brand-700/50 transition hover:bg-white/60 hover:text-brand-700"
            >
              <IconClose size={15} />
            </button>
          </Card>
        ) : null}

        <section>
          <div className="mb-1 flex items-baseline justify-between px-1">
            <h2 className="text-[15px] font-bold tracking-tight text-slate-900">
              Recent activity
            </h2>
            <button
              type="button"
              onClick={() => navigate("/history")}
              className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand-700 transition hover:bg-brand-50"
            >
              View all
            </button>
          </div>
          <TransactionList
            transactions={transactions?.slice(0, 5) ?? null}
            userId={userId ?? 0}
            onSelect={setSelected}
            emptyAction={
              <button
                type="button"
                onClick={() => navigate("/pay/amount", { state: { mode: "topup" } })}
                className="rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white"
              >
                Add money
              </button>
            }
          />
        </section>
      </div>

      <TransactionDetailSheet
        transaction={selected}
        userId={userId ?? 0}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </AppShell>
  );
}
