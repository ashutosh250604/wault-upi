import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WalletTransaction } from "../types";
import { firstName } from "../lib/format";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { useRecentPeople } from "../hooks/useRecentPeople";
import { useMoneyRequests } from "../hooks/useMoneyRequests";
import { useNotifications } from "../hooks/useNotifications";
import { useAppSession } from "../session/context";
import { AppShell, BrandMark } from "../components/AppShell";
import { BalanceCard } from "../components/BalanceCard";
import { NotificationBell } from "../components/NotificationBell";
import { OffersStrip } from "../components/OffersStrip";
import { PeopleSection } from "../components/People";
import { RequestsBanner } from "../components/Requests";
import { TransactionDetailSheet, TransactionList } from "../components/Transactions";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ErrorState } from "../components/ui/States";
import {
  IconArrowRight,
  IconClose,
  IconLock,
  IconPlus,
  IconQr,
  IconReceipt,
  IconScan,
  IconSpark,
} from "../components/ui/Icons";

const TIP_KEY = "walletpay.tipDismissed";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function QuickAction({
  to,
  label,
  icon,
  tone,
  state,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
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
        {icon}
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

  // The people row is refreshed by whatever transaction the ledger most
  // recently gained, so paying someone moves them to the front of the strip.
  const { people, status: peopleStatus, reload: reloadPeople } = useRecentPeople(
    8,
    transactions?.[0]?.id ?? null,
  );
  const { startPayment } = usePayeeResolution();
  // Same reload key as the people strip: a settled request also mints a
  // transaction, so both views refresh off the newest ledger row.
  const { requests } = useMoneyRequests(transactions?.[0]?.id ?? null);
  // The newest ledger row is equally the signal for new notifications and for
  // offers that may have just been earned.
  const { unreadCount } = useNotifications(transactions?.[0]?.id ?? null);
  const latestTransactionId = transactions?.[0]?.id ?? null;

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
      scrollHeader
      onRefresh={() => void onRefresh()}
      header={
        <header className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-600 to-fuchsia-600 px-5 pt-[max(0.85rem,env(safe-area-inset-top))] pb-16 text-white">
          <span className="pointer-events-none absolute -top-20 -right-12 size-44 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute -bottom-24 -left-16 size-52 rounded-full bg-white/10" />

          <div className="relative flex items-center gap-2">
            <BrandMark invert />
            <div className="flex-1" />
            <NotificationBell unreadCount={unreadCount} invert />
            <Link
              to="/profile"
              aria-label="Open profile"
              className="rounded-full ring-2 ring-white/30 transition hover:ring-white/60 focus-visible:outline-none focus-visible:ring-white"
            >
              <Avatar name={displayName} size="md" tone="gradient" />
            </Link>
          </div>

          <div className="relative mt-5">
            <p className="text-[12.5px] text-white/80">
              {greeting()}, <span className="font-semibold text-white">{firstName(displayName)}</span>
            </p>
            <div className="mt-2.5">
              <BalanceCard
                balance={profile?.balance ?? null}
                vpa={profile?.vpa ?? null}
                loading={loading}
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
              />
            </div>
          </div>
        </header>
      }
    >
      {/* Lifted above the hero: it is positioned, so without this it would paint
          over the first 44px of the quick-action card that overlaps it. */}
      <div className="relative z-10 -mt-11 space-y-6 px-5 pb-6">
        <div className="grid grid-cols-4 gap-1 rounded-3xl border border-slate-100 bg-white p-2 shadow-lg shadow-slate-900/5">
          <QuickAction
            to="/scan"
            label="Scan & pay"
            icon={<IconScan size={21} />}
            tone="bg-brand-50 text-brand-600"
          />
          <QuickAction
            to="/my-qr"
            label="My QR"
            icon={<IconQr size={21} />}
            tone="bg-fuchsia-50 text-fuchsia-600"
          />
          <QuickAction
            to="/pay/amount"
            label="Add money"
            icon={<IconPlus size={21} />}
            tone="bg-emerald-50 text-emerald-600"
            state={{ mode: "topup" }}
          />
          <QuickAction
            to="/history"
            label="History"
            icon={<IconReceipt size={21} />}
            tone="bg-slate-100 text-slate-600"
          />
        </div>

        <RequestsBanner requests={requests ?? []} onOpen={() => navigate("/requests")} />

        <PeopleSection
          people={people}
          status={peopleStatus}
          onSelect={(person) => startPayment(person)}
          onAdd={() => navigate("/contacts", { state: { add: true } })}
          onRetry={reloadPeople}
          onSeeAll={() => navigate("/contacts")}
        />

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
                  Your account was created but the 4-digit PIN step was never finished, so
                  payments can't be approved yet.
                </p>
              </div>
            </div>
            <Button size="sm" fullWidth onClick={() => navigate("/onboarding/pin")}>
              Set my PIN
            </Button>
          </Card>
        ) : null}

        {status === "error" && profile === null ? (
          <Card>
            <ErrorState
              message={error ?? "We couldn't load your wallet."}
              onRetry={() => void onRefresh()}
            />
          </Card>
        ) : null}

        <OffersStrip reloadKey={latestTransactionId} />

        <section>
          <div className="mb-1 flex items-baseline justify-between px-1">
            <h2 className="text-[15px] font-bold tracking-tight text-slate-900">
              Recent activity
            </h2>
            <button
              type="button"
              onClick={() => navigate("/history")}
              className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand-700 transition hover:bg-brand-50"
            >
              View all <IconArrowRight size={14} />
            </button>
          </div>
          <TransactionList
            transactions={transactions?.slice(0, 5) ?? null}
            userId={userId ?? 0}
            onSelect={setSelected}
            emptyDescription="Top up your wallet, then pay anyone by QR or UPI ID."
            emptyAction={
              <Button
                size="sm"
                onClick={() => navigate("/pay/amount", { state: { mode: "topup" } })}
              >
                Add money
              </Button>
            }
          />
        </section>

        {!tipDismissed ? (
          <Card className="flex gap-3 bg-gradient-to-br from-brand-50 to-fuchsia-50/60 ring-1 ring-brand-100">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
              <IconSpark size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-brand-900">Get paid in one tap</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-brand-900/70">
                Share your UPI ID{" "}
                {profile?.vpa ? (
                  <span className="font-mono font-semibold">{profile.vpa}</span>
                ) : (
                  "or QR code"
                )}{" "}
                and anyone can pay you without typing a number.
              </p>
              <Link
                to="/my-qr"
                className="mt-1.5 inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-brand-700"
              >
                Show my QR <IconArrowRight size={14} />
              </Link>
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
