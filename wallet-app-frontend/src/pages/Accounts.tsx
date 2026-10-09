import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type { LinkedAccount } from "../types";
import { api, errorMessage } from "../lib/api";
import { avatarToneFor } from "../lib/avatar";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime } from "../lib/format";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { PinPad } from "../components/PinPad";
import { StatementDownload } from "../components/StatementDownload";
import { Avatar, Badge } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { IconEye, IconInfo, IconLock, IconWallet } from "../components/ui/Icons";
import { Sheet } from "../components/ui/Sheet";
import { EmptyState, ErrorState } from "../components/ui/States";

/**
 * A bank stamp reads like a bank mark, not a person's initials: "HDFC", "SBI".
 * All-caps first words are already brand marks; otherwise take initial letters.
 */
const STOP_WORDS = new Set(["of", "and", "the", "for", "&", "co", "ltd", "limited"]);

function bankMark(name: string): string {
  const words = name
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => Boolean(word) && !STOP_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return "BK";
  const first = words[0];
  if (first.length <= 6 && first === first.toUpperCase()) return first;
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  return first.slice(0, 2).toUpperCase();
}

/**
 * Linked accounts. The balance is behind a PIN on purpose: in UPI, seeing a bank
 * balance is an authenticated action, not just a screen you can open.
 */
export default function AccountsPage() {
  const toast = useToast();
  const { userId } = useAppSession();

  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [checkTarget, setCheckTarget] = useState<LinkedAccount | null>(null);
  const [revealed, setRevealed] = useState<Record<number, { balance: number; at: string }>>({});
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [shakeToken, setShakeToken] = useState(0);
  const [checking, setChecking] = useState(false);
  // Bumped by the retry card so the effect re-runs without a full page reload.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setAccounts(await api.accounts(controller.signal));
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(errorMessage(err));
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  if (!userId) return <Navigate to="/login" replace />;

  const closePin = () => {
    setCheckTarget(null);
    setPin("");
    setPinError(null);
  };

  const checkBalance = async (enteredPin: string) => {
    if (!checkTarget || checking) return;
    setChecking(true);
    setPinError(null);
    try {
      const result = await api.checkAccountBalance(checkTarget.id, enteredPin);
      setRevealed((current) => ({
        ...current,
        [checkTarget.id]: { balance: result.balance, at: result.checked_at },
      }));
      feedback.success();
      closePin();
    } catch (err) {
      const message = errorMessage(err);
      setPinError(message);
      setShakeToken((token) => token + 1);
      setPin("");
      feedback.warn();
    } finally {
      setChecking(false);
    }
  };

  const makeDefault = async (account: LinkedAccount) => {
    setBusyId(account.id);
    try {
      const result = await api.setDefaultAccount(account.id);
      setAccounts((current) =>
        (current ?? []).map((item) =>
          item.id === result.account.id
            ? { ...item, is_default: true }
            : { ...item, is_default: false },
        ),
      );
      toast.success(result.message);
      feedback.tap();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell
      header={<AppBar title="Linked accounts" showBack />}
      footer={
        <div className="shrink-0 border-t border-ink-200 bg-paper-50 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <StatementDownload variant="secondary" size="lg" fullWidth />
        </div>
      }
    >
      <div className="space-y-4 px-5 pt-4 pb-6">
        {accounts === null && error === null ? (
          <Card className="space-y-3" aria-hidden="true">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="size-12 animate-pulse rounded-[10px] bg-paper-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 animate-pulse rounded-[3px] bg-paper-200" />
                  <div className="h-3 w-40 animate-pulse rounded-[3px] bg-paper-200" />
                </div>
              </div>
            ))}
          </Card>
        ) : null}

        {error && accounts === null ? (
          <Card>
            <ErrorState
              message={error}
              onRetry={() => {
                setError(null);
                setReloadKey((key) => key + 1);
              }}
            />
          </Card>
        ) : null}

        {accounts !== null && accounts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconWallet size={22} />}
              title="No linked accounts"
              description="In a real app you'd link a bank account here before you could add money to the wallet."
            />
          </Card>
        ) : null}

        {accounts?.map((account) => {
          const shown = revealed[account.id];
          const isBusy = busyId === account.id;

          return (
            <Card key={account.id} className="space-y-3.5">
              <div className="flex items-center gap-3">
                <Avatar
                  label={bankMark(account.bank_name)}
                  size="lg"
                  tone={avatarToneFor(`${account.bank_name}${account.masked_number}`)}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-display text-[14.5px] font-bold tracking-tight text-ink-900">
                    <span className="truncate">{account.bank_name}</span>
                    {account.is_default ? <Badge tone="brand">Default</Badge> : null}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 font-mono text-[12px] text-ink-500">
                    <span className="truncate tabular-nums">{account.masked_number}</span>
                    {account.ifsc ? (
                      <>
                        <span aria-hidden="true" className="h-3 w-px shrink-0 bg-ink-200" />
                        <span className="min-w-0 truncate">{account.ifsc}</span>
                      </>
                    ) : null}
                  </p>
                  {account.holder_name ? (
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
                      {account.holder_name}
                    </p>
                  ) : null}
                </div>
              </div>

              {shown ? (
                <div className="rounded-[8px] bg-credit-50 px-3.5 py-3 ring-1 ring-credit-100 ring-inset">
                  <p className="text-[12px] font-medium text-credit-700">Available balance</p>
                  <p className="mt-1 font-display text-[21px] leading-none font-extrabold tracking-[-0.02em] tabular-nums text-credit-700">
                    {formatCurrency(shown.balance)}
                  </p>
                  <p className="mt-1.5 text-[11.5px] text-credit-700/75">
                    Checked {formatDateTime(shown.at)}
                  </p>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  fullWidth
                  size="sm"
                  leftIcon={<IconEye size={15} />}
                  onClick={() => setCheckTarget(account)}
                >
                  {shown ? "Check again" : "Check balance"}
                </Button>
                <Button
                  variant={account.is_default ? "ghost" : "primary"}
                  fullWidth
                  size="sm"
                  loading={isBusy}
                  disabled={account.is_default || isBusy}
                  onClick={() => void makeDefault(account)}
                >
                  {account.is_default ? "Already default" : "Make default"}
                </Button>
              </div>
            </Card>
          );
        })}

        <Card tone="muted" className="flex gap-2.5">
          <IconLock size={16} className="mt-px shrink-0 text-ink-500" />
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            Balances stay hidden until you enter your PIN — the same server check that
            authorises a payment. Only the last four digits of an account number are ever
            stored.
          </p>
        </Card>

        <p className="flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-ink-500">
          <IconInfo size={14} className="mt-px shrink-0" />
          Top-up money is debited from your default account, so its balance drops as your
          wallet grows.
        </p>
      </div>

      <Sheet
        open={checkTarget !== null}
        onClose={closePin}
        title="Enter your PIN"
        description={
          checkTarget
            ? `To see the balance on ${checkTarget.bank_name} ${checkTarget.masked_number}`
            : undefined
        }
        dismissible={!checking}
      >
        <PinPad
          value={pin}
          onChange={setPin}
          onComplete={(entered) => void checkBalance(entered)}
          error={pinError}
          shakeToken={shakeToken}
          busy={checking}
          busyLabel="Checking balance…"
          autoSubmit={!checking}
        />
        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-ink-500">
          Five wrong attempts lock the PIN for 15 minutes. The lockout is enforced by the
          server, not just this screen.
        </p>
      </Sheet>
    </AppShell>
  );
}
