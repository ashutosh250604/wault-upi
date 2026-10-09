import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WalletTransaction } from "../types";
import { firstName, istHour } from "../lib/format";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { useRecentPeople } from "../hooks/useRecentPeople";
import { useCoins } from "../hooks/useCoins";
import { useIncomingCue } from "../hooks/useIncomingCue";
import { useMoneyRequests } from "../hooks/useMoneyRequests";
import { useNotifications } from "../hooks/useNotifications";
import { useAppSession } from "../session/context";
import { cx } from "../lib/cx";
import { AppShell, BrandMark } from "../components/AppShell";
import { BalanceCard, BalanceRefresh } from "../components/BalanceCard";
import { CoinsSheet } from "../components/CoinsSheet";
import { NotificationBell } from "../components/NotificationBell";
import { OffersStrip } from "../components/OffersStrip";
import { PeopleSection } from "../components/People";
import { RequestsBanner } from "../components/Requests";
import { TransactionDetailSheet, TransactionList } from "../components/Transactions";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card, SectionTitle, TextLink } from "../components/ui/Card";
import { ErrorState } from "../components/ui/States";
import { Coin } from "../components/ui/Coin";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import {
  IconLock,
  IconPlus,
  IconQr,
  IconReceipt,
  IconReceived,
  IconScan,
} from "../components/ui/Icons";
import { feedback } from "../lib/feedback";

/** The greeting follows the IST clock, not the browser's — see `istHour`. */
function greeting(): string {
  const hour = istHour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * One quick action. These used to share a single bordered ticket; they are now
 * four separate slips — each with its own inked edge and hard print shadow —
 * spaced tightly enough that the row still reads as one object.
 *
 * The icon sits in a double-ring stamp: a solid inked circle with a dashed
 * impression inside it.
 */
function IndexItem({
  to,
  label,
  Icon,
  state,
  tone = "text-ink-900",
  className,
}: {
  to: string;
  label: string;
  Icon: (props: { size?: number; strokeWidth?: number }) => React.ReactNode;
  state?: unknown;
  tone?: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      state={state}
      className={cx(
        "flex flex-col items-center gap-1 rounded-[10px] border-[1.5px] border-ink-900 bg-paper-25 px-1 py-1.5 text-center text-[10.5px] leading-[1.15] font-semibold text-ink-700",
        "shadow-[2px_2px_0_0_rgba(25,25,22,0.85)] transition",
        "hover:bg-paper-100 active:translate-y-px active:bg-paper-200 active:shadow-[1px_1px_0_0_rgba(25,25,22,0.85)]",
        "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
        className,
      )}
    >
      {/* The same tile the lists use, printed rather than stamped: an inked
          edge with a dashed impression inside it. It was a circle at 32px;
          squaring it and matching the radius is what puts the home screen's
          four actions in the same family as every other icon in the app. */}
      <span
        className={cx(
          "relative flex size-9 shrink-0 items-center justify-center rounded-[10px] border-[1.5px] border-ink-900 bg-paper-100",
          tone,
        )}
      >
        <Icon size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[3px] rounded-[7px] border border-dashed border-ink-900/35"
        />
      </span>
      {label}
    </Link>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { userId, session, profile, transactions, status, error, refresh } = useAppSession();
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<WalletTransaction | null>(null);

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
  // Coins are counted from the ledger, so the newest row is exactly when the
  // tally can have changed — a payment today may have been the third one.
  const { coins, setCoins } = useCoins(latestTransactionId);
  const [coinsOpen, setCoinsOpen] = useState(false);
  const claimable = (coins?.redeemable ?? 0) > 0;
  // Money arriving gets its own sound: a payment you made and a payment you
  // received must not be the same noise.
  useIncomingCue(transactions, userId);

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

  return (
    <AppShell
      nav
      scrollHeader
      onRefresh={() => void onRefresh()}
      header={
        /* A receipt head, not three loose rows: brand + controls share one
           stamped tray, a dashed ledger rule closes the masthead, and the
           balance sits alone under it as the hero numeral. */
        <header className="relative bg-ink-900 px-5 pt-[max(0.65rem,env(safe-area-inset-top))] pb-8 text-ink-25">
          {/* The masthead: the full lockup, at a size the eye lands on before
              the controls beside it. It used to be the smallest thing in its own
              row — a 26px seal and 16.5px type next to a 36px button cluster, so
              the brand read as one more chip in the toolbar. The seal now
              matches the cluster's height and the name is the largest label on
              the ink, while the row itself is unchanged: same padding, same
              shadow, same everything else. */}
          <div className="flex items-center gap-3">
            <BrandMark invert sealSize={33} wordClassName="text-[21px]" className="gap-2.5" />
            <span className="flex-1" />
            <div className="flex items-center gap-1 rounded-[12px] bg-ink-800 p-1 ring-1 ring-ink-700">
              <NotificationBell unreadCount={unreadCount} invert />
              {/* The coin chip sits between the bell and the profile, where the
                  eye already passes on the way to the avatar. Its glyph is the
                  coin artwork itself rather than an outline drawn to look like
                  one: the same file the reward rows and the scratch card show,
                  so the chip and the coins sheet are visibly the same object. */}
              <button
                type="button"
                onClick={() => {
                  feedback.tap();
                  setCoinsOpen(true);
                }}
                aria-label={
                  coins === null
                    ? "Coins"
                    : `Coins, ${coins.coins} available, worth ₹${coins.value}`
                }
                className="relative flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-[12px] font-bold text-pending-100 transition hover:bg-ink-700 hover:text-pending-50 focus-visible:ring-2 focus-visible:ring-ink-25 focus-visible:outline-none"
              >
                <Coin size={16} />
                {coins ? (
                  <span className="tabular-nums">{coins.coins}</span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="block h-3 w-3.5 animate-pulse rounded-[3px] bg-ink-600"
                  />
                )}
                {claimable ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-seal-500 ring-2 ring-ink-800"
                  />
                ) : null}
              </button>
              <Link
                to="/profile"
                aria-label="Open profile"
                className="rounded-[8px] ring-1 ring-ink-600 transition hover:ring-ink-400 focus-visible:ring-2 focus-visible:ring-ink-25 focus-visible:outline-none"
              >
                <Avatar name={displayName} size="sm" tone="paper" />
              </Link>
            </div>
          </div>

          <span
            aria-hidden="true"
            className="mt-2.5 block border-t border-dashed border-ink-700/80"
          />

          {/* Three registers, one per line, in descending size: who the wallet
              is greeting, what is in it, and the handle it answers to. The
              refresh shares the greeting's line rather than the balance's —
              that row had room in it, and this keeps the numeral alone on its
              own with the eye toggle, which is the one control that is about
              the amount itself. */}
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[12px] text-ink-400">
              {greeting()},{" "}
              <span className="font-display font-semibold text-ink-100">
                {firstName(displayName)}
              </span>
            </p>
            <BalanceRefresh refreshing={refreshing} onRefresh={() => void onRefresh()} />
          </div>

          <div className="mt-2.5">
            <BalanceCard
              balance={profile?.balance ?? null}
              vpa={profile?.vpa ?? null}
              loading={loading}
            />
          </div>

          {/* The tear line: the paper part of the app begins here. It sits in
              the ink above the scan button rather than behind it, so the rule
              the whole composition rests on is actually visible. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-5 bottom-[18px] border-b border-dashed border-ink-700"
          />
        </header>
      }
    >
      {/* Lifted above the tear line so the scan button sits half on the ink
          hero and half on the paper — the one overlap in the app. */}
      <div className="relative z-10 -mt-4 space-y-2.5 px-5 pb-4">
        {/* A warm slip with an inked hairline, so the label stays legible even
            where the button crosses the dark tear line. */}
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => navigate("/scan")}
          leftIcon={<IconScan size={19} />}
          className="shadow-[0_18px_34px_-20px_rgba(15,15,13,0.95)]"
        >
          Scan &amp; pay
        </Button>

        {/* Four separate slips rather than one ticket: each action now owns its
            edge and its shadow, which is what makes them read as four buttons
            instead of four cells of a single control. */}
        <div className="grid grid-cols-4 gap-1.5">
          <IndexItem to="/my-qr" label="My QR" Icon={IconQr} />
          <IndexItem to="/pay/amount" label="Add money" Icon={IconPlus} state={{ mode: "topup" }} />
          <IndexItem
            to="/requests"
            label="Request money"
            Icon={IconReceived}
            tone="text-credit-600"
            state={{ compose: true }}
          />
          <IndexItem to="/history" label="Transactions" Icon={IconReceipt} />
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
          // No 4px seal rule down the left edge: the tile says the tone, and a
          // second red mark on the same card only repeated it.
          <Card className="space-y-3">
            <div className="flex gap-3">
              <IconTile tone="seal" scale="sm">
                <IconLock size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />
              </IconTile>
              <div>
                <p className="text-[13.5px] font-semibold text-ink-900">
                  Set your PIN to start paying
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">
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

        <OffersStrip reloadKey={latestTransactionId} compact />

        <section>
          <SectionTitle
            className="mb-0.5"
            action={
              <TextLink
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/history");
                }}
              >
                View all
              </TextLink>
            }
          >
            Transactions
          </SectionTitle>
          <TransactionList
            // Two, not five: the home screen is an at-a-glance summary and has
            // to fit one screen, and the full ledger is one tap away in "View
            // all".
            transactions={transactions?.slice(0, 2) ?? null}
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

      </div>

      <TransactionDetailSheet
        transaction={selected}
        userId={userId ?? 0}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />

      <CoinsSheet
        open={coinsOpen}
        onClose={() => setCoinsOpen(false)}
        coins={coins}
        onRedeemed={setCoins}
        onBalanceChanged={() => void refresh({ silent: true })}
      />
    </AppShell>
  );
}
