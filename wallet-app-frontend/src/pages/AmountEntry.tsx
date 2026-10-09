import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { CreditedReward, LimitsResponse, LinkedAccount } from "../types";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatCurrencyShort, groupAmountInput } from "../lib/format";
import { parsePaymentIntent } from "../lib/routing";
import {
  MAX_TOPUP_RUPEES,
  MAX_TRANSFER_RUPEES,
  amountError,
  toRupees,
} from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { AmountKeypad } from "../components/AmountKeypad";
import { PinPad } from "../components/PinPad";
import { ReceiverCard } from "../components/ReceiverCard";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextArea } from "../components/ui/Field";
import { IconCheck, IconInfo, IconNote, IconWarning } from "../components/ui/Icons";
import { Sheet } from "../components/ui/Sheet";

const QUICK_AMOUNTS = [100, 500, 1000, 2000];

export default function AmountEntryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { userId, profile, patchProfile, refresh } = useAppSession();

  const intent = useMemo(() => parsePaymentIntent(location.state), [location.state]);
  const isTopUp = intent?.mode === "topup";

  const [amount, setAmount] = useState(() =>
    intent?.suggestedAmount ? String(intent.suggestedAmount) : "",
  );
  const [note, setNote] = useState(intent?.note ?? "");
  const [touched, setTouched] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const [paying, setPaying] = useState(false);
  // Funding sources appear only for a top-up: paying someone never touches them.
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  // Today's cap, straight from the endpoint the ledger itself reads.
  const [limits, setLimits] = useState<LimitsResponse | null>(null);

  const available = profile?.balance ?? null;
  const rules =
    isTopUp || available === null
      ? { max: MAX_TOPUP_RUPEES }
      : {
          max: MAX_TRANSFER_RUPEES,
          available,
          // The cap is enforced by the ledger; showing it here is what stops the
          // user discovering it only after typing a PIN.
          dailyRemaining: limits?.remaining,
        };

  const value = toRupees(amount);
  const issue = amountError(amount, rules);
  const canPay = issue === null;
  const shownIssue = touched ? issue : null;

  // Keep the pay button's label honest while the amount is still empty.
  useEffect(() => {
    if (amount === "") setTouched(false);
  }, [amount]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setLimits(await api.limits(controller.signal));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLimits(null);
      }
    })();
    return () => controller.abort();
  }, []);

  // Load the linked accounts and preselect the user's default one.
  useEffect(() => {
    if (!isTopUp) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const list = await api.accounts(controller.signal);
        setAccounts(list);
        setSourceId(list.find((item) => item.is_default)?.id ?? list[0]?.id ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAccounts([]);
      }
    })();
    return () => controller.abort();
  }, [isTopUp]);

  if (!intent || !userId) return <Navigate to="/home" replace />;

  const receiverLabel = isTopUp ? "your wallet" : (intent.receiverName ?? "recipient");
  /**
   * A payment can complete an offer; say so once, at the moment it lands.
   *
   * "Earned", not "credited": an offer pays coins, and coins are not in the
   * balance until they are redeemed.
   */
  const announceRewards = (rewards?: CreditedReward[]) => {
    for (const reward of rewards ?? []) {
      toast.success(`${reward.title} earned`);
    }
  };
  const closePin = () => {
    setPinOpen(false);
    setPin("");
    setPinError(null);
    setNeedsPinSetup(false);
  };

  const pay = async (enteredPin: string) => {
    if (paying) return;
    setPaying(true);
    setPinError(null);

    try {
      if (isTopUp) {
        // The PIN is verified server-side with the debit, and the chosen account
        // is charged in the same transaction that credits the wallet.
        const result = await api.topUp(userId, value, enteredPin, sourceId ?? undefined);
        feedback.paid();
        patchProfile({ balance: result.new_balance });
        announceRewards(result.rewards);
        void refresh({ silent: true });
        navigate("/pay/result", {
          replace: true,
          state: {
            receipt: {
              kind: "topup",
              amount: value,
              reference: result.txn_id,
              counterpartyName: "Your wallet",
              counterpartyVpa: profile?.vpa ?? null,
              note: null,
              timestamp: new Date().toISOString(),
              cashback: result.rewards,
            },
          },
        });
        return;
      }

      // The PIN travels with the payment, so the server authorises the debit
      // itself — there is no gap between "PIN was fine" and "money moved".
      const result = await api.transfer(
        intent.receiverId as number,
        value,
        note.trim() || null,
        enteredPin,
      );
      feedback.paid();
      if (available !== null) patchProfile({ balance: Math.max(0, available - value) });
      announceRewards(result.rewards);
      void refresh({ silent: true });
      navigate("/pay/result", {
        replace: true,
        state: {
          receipt: {
            kind: "transfer",
            amount: result.amount,
            reference: result.txn_id,
            counterpartyName: intent.receiverName ?? "Recipient",
            counterpartyVpa: intent.receiverVpa ?? null,
            note: result.note,
            timestamp: new Date().toISOString(),
            // The draw this payment made, carried to the result screen so the
            // scratch card has something to hide.
            coinsEarned: result.coins_earned,
            cashback: result.rewards,
            // The card itself, so scratching it on the receipt closes the same
            // card on the collection screen.
            cardId: result.coin_card_id,
          },
        },
      });
    } catch (err) {
      const message = errorMessage(err);
      setPinError(message);
      setShakeToken((token) => token + 1);
      setPin("");
      // A 403 "PIN not set" means onboarding was never finished.
      if (message.toLowerCase().includes("pin not set")) setNeedsPinSetup(true);
      if (!message.toLowerCase().includes("incorrect pin") &&
          !message.toLowerCase().includes("pin not set")) {
        toast.error(message);
      }
    } finally {
      setPaying(false);
    }
  };

  return (
    <AppShell
      header={
        <AppBar
          title={isTopUp ? "Add money" : "Pay"}
          showBack
          right={
            <span className="pr-2 text-[12px] font-medium text-ink-500">
              {isTopUp ? "To your wallet" : "To a UPI ID"}
            </span>
          }
        />
      }
      footer={
        <div className="shrink-0 border-t border-ink-200 bg-paper-50 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Disabled while the PIN sheet is open, so a hardware keyboard can't
              type into the amount behind the dialog. */}
          <AmountKeypad
            value={amount}
            onChange={setAmount}
            disabled={paying || pinOpen}
          />
          <Button
            fullWidth
            size="lg"
            className="mt-2.5"
            disabled={!canPay}
            onClick={() => {
              setTouched(true);
              setPinOpen(true);
            }}
          >
            {canPay
              ? `${isTopUp ? "Add" : "Pay"} ${formatCurrency(value)}`
              : "Enter an amount"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 pt-4 pb-5">
        {isTopUp ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-[10px] border-[1.5px] border-ink-900/75 bg-paper-25 p-3.5">
              <Avatar name={profile?.name} size="md" tone="ink" />
              <div className="min-w-0">
                <p className="truncate font-display text-[15.5px] font-bold tracking-tight text-ink-900">
                  {profile?.name ?? "Your wallet"}
                </p>
                <p className="truncate font-mono text-[12px] text-ink-500">
                  Wallet balance {formatCurrency(available ?? 0)}
                </p>
              </div>
            </div>

            {accounts && accounts.length > 0 ? (
              <div className="rounded-[10px] border-[1.5px] border-ink-900/75 bg-paper-25 p-3">
                <p className="px-1 pb-1.5 text-[12px] font-semibold text-ink-500">
                  Add money from
                </p>
                {accounts.map((account) => {
                  const selected = sourceId === account.id;
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => {
                        feedback.tap();
                        setSourceId(account.id);
                      }}
                      aria-pressed={selected}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-[8px] p-2.5 text-left transition",
                        selected
                          ? "bg-paper-100 ring-[1.5px] ring-ink-900/80 ring-inset"
                          : "hover:bg-paper-100 active:bg-paper-200",
                      )}
                    >
                      <span
                        className={cx(
                          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2 transition",
                          selected
                            ? "border-ink-900 bg-ink-900 text-paper-25"
                            : "border-ink-300",
                        )}
                      >
                        {selected ? <IconCheck size={10} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink-800">
                          {account.bank_name}
                        </span>
                        <span className="block truncate font-mono text-[11.5px] text-ink-500 tabular-nums">
                          {account.masked_number}
                        </span>
                      </span>
                      {account.is_default ? (
                        <span className="shrink-0 rounded-[5px] bg-ink-900 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-25">
                          Default
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <ReceiverCard
              name={intent.receiverName ?? null}
              vpa={intent.receiverVpa ?? null}
            />
            <div className="flex justify-end px-1">
              <Link to="/scan" className="text-[12.5px] font-semibold text-seal-700 underline decoration-seal-300 decoration-1 underline-offset-4">
                Change recipient
              </Link>
            </div>
          </div>
        )}

        <div className="pt-1 text-center">
          <p className="text-[12px] font-medium text-ink-500">
            {isTopUp ? "Amount to add" : "Amount to pay"}
          </p>
          <p
            className={cx(
              "mt-2 font-display text-[3.1rem] leading-none font-extrabold tracking-[-0.04em] tabular-nums",
              amount ? "text-ink-900" : "text-ink-300",
            )}
          >
            ₹{amount ? groupAmountInput(amount) : "0"}
          </p>
          <div className="mt-3 flex min-h-5 items-center justify-center" aria-live="polite">
            {shownIssue ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-seal-700">
                <IconWarning size={14} />
                {shownIssue}
              </span>
            ) : isTopUp ? (
              <span className="text-[12.5px] text-ink-500">
                Limit {formatCurrency(MAX_TOPUP_RUPEES)} per top-up
              </span>
            ) : available !== null ? (
              <span className="text-[12.5px] text-ink-500">
                Available balance {formatCurrency(available)}
              </span>
            ) : null}
          </div>

          {!isTopUp && limits ? (
            <div className="mt-1">
              <div className="mx-auto h-1 w-44 overflow-hidden rounded-full bg-paper-200">
                <span
                  className={cx(
                    "block h-full origin-left rounded-full transition-transform",
                    limits.used_percent >= 90 ? "bg-seal-500" : "bg-ink-900",
                  )}
                  style={{
                    transform: `scaleX(${Math.min(1, Math.max(0, limits.used_percent / 100))})`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-500">
                {formatCurrencyShort(limits.remaining)} of your{" "}
                {formatCurrencyShort(limits.daily_limit)} daily limit left
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-center gap-2">
          {QUICK_AMOUNTS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                feedback.tap();
                setAmount(String(preset));
                setTouched(true);
              }}
              className={cx(
                "rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition",
                "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
                value === preset
                  ? "bg-ink-900 text-ink-25 ring-[1.5px] ring-ink-900 ring-inset"
                  : "border-[1.5px] border-ink-900/40 bg-paper-100 text-ink-700 hover:bg-paper-200 active:bg-paper-300",
              )}
            >
              {formatCurrencyShort(preset)}
            </button>
          ))}
        </div>

        {!isTopUp ? (
          <div className="space-y-1.5">
            <label
              htmlFor="payment-note"
              className="flex items-center gap-1.5 px-1 text-[12.5px] font-semibold text-ink-700"
            >
              <IconNote size={14} className="text-ink-400" /> Add a note (optional)
            </label>
            <TextArea
              id="payment-note"
              rows={2}
              maxLength={140}
              placeholder="Dinner, rent, tickets…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="px-1 text-right text-[11.5px] text-ink-400">
              {note.length}/140
            </p>
          </div>
        ) : null}

        <Card tone="muted" className="flex gap-2.5">
          <IconInfo size={16} className="mt-px shrink-0 text-ink-400" />
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            {isTopUp
              ? "Your bank and your wallet update together, so both always show the same amount."
              : "Your balance is checked and the money sent in the same step, so you can never send more than you have."}
          </p>
        </Card>
      </div>

      <Sheet
        open={pinOpen}
        onClose={closePin}
        title={`${isTopUp ? "Add" : "Pay"} ${formatCurrency(value)}`}
        description={`${isTopUp ? "Crediting" : "Paying"} ${receiverLabel}`}
        dismissible={!paying}
      >
        <PinPad
          value={pin}
          onChange={setPin}
          onComplete={(entered) => void pay(entered)}
          error={pinError}
          shakeToken={shakeToken}
          busy={paying}
          busyLabel={isTopUp ? "Adding money…" : "Sending money…"}
          autoSubmit={!paying}
          onForgotPin={() => {
            closePin();
            navigate("/onboarding/pin");
          }}
        />
        {needsPinSetup ? (
          <Card tone="muted" className="mt-5 text-center">
            <p className="text-[12.5px] text-ink-600">
              No PIN is set on this account yet.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => navigate("/onboarding/pin")}
            >
              Set a PIN now
            </Button>
          </Card>
        ) : (
          <p className="mt-5 text-center text-[11.5px] leading-relaxed text-ink-400">
            Your PIN is sent over HTTPS, checked on the server before any money moves,
            and never stored in plain text.
          </p>
        )}
      </Sheet>
    </AppShell>
  );
}
