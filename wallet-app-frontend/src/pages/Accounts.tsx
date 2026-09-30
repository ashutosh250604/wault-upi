import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type { LinkedAccount } from "../types";
import { api, errorMessage } from "../lib/api";
import { saveBlob } from "../lib/download";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime } from "../lib/format";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { PinPad } from "../components/PinPad";
import { Badge } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import {
  IconDownload,
  IconEye,
  IconInfo,
  IconLock,
  IconWallet,
  IconWarning,
} from "../components/ui/Icons";
import { Sheet } from "../components/ui/Sheet";
import { EmptyState, ErrorState } from "../components/ui/States";

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
  const [exporting, setExporting] = useState(false);

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
  }, []);

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

  const exportStatement = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.statementCsv();
      saveBlob(blob, filename);
      toast.success(`Statement saved as ${filename}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell
      header={<AppBar title="Linked accounts" showBack />}
      footer={
        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            fullWidth
            variant="secondary"
            loading={exporting}
            leftIcon={<IconDownload size={17} />}
            onClick={() => void exportStatement()}
          >
            Download statement (CSV)
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 pt-4 pb-6">
        {accounts === null && error === null ? (
          <Card className="space-y-3" aria-hidden="true">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="size-12 animate-pulse rounded-2xl bg-slate-200/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200/80" />
                  <div className="h-3 w-40 animate-pulse rounded bg-slate-200/80" />
                </div>
              </div>
            ))}
          </Card>
        ) : null}

        {error && accounts === null ? (
          <Card>
            <ErrorState message={error} onRetry={() => window.location.reload()} />
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
            <Card key={account.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-[15px] font-bold text-brand-700">
                  {account.bank_name.replace(/[^A-Za-z ]/g, "").trim().split(/\s+/)[0]
                    ?.slice(0, 2)
                    .toUpperCase() ?? "BK"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14.5px] font-semibold text-slate-900">
                    <span className="truncate">{account.bank_name}</span>
                    {account.is_default ? <Badge tone="brand">Default</Badge> : null}
                  </p>
                  <p className="truncate text-[12.5px] text-slate-500 tabular-nums">
                    {account.masked_number}
                    {account.ifsc ? ` · ${account.ifsc}` : ""}
                  </p>
                  {account.holder_name ? (
                    <p className="truncate text-[11.5px] text-slate-400">
                      {account.holder_name}
                    </p>
                  ) : null}
                </div>
              </div>

              {shown ? (
                <div className="rounded-xl bg-emerald-50 px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold tracking-wide text-emerald-700 uppercase">
                    Available balance
                  </p>
                  <p className="mt-0.5 text-[19px] font-bold tabular-nums text-emerald-700">
                    {formatCurrency(shown.balance)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-emerald-700/70">
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
          <IconLock size={16} className="mt-px shrink-0 text-slate-400" />
          <p className="text-[12.5px] leading-relaxed text-slate-600">
            Balances stay hidden until you enter your PIN — the same server check that
            authorises a payment. Only the last four digits of an account number are ever
            stored.
          </p>
        </Card>

        <Card tone="muted" className="flex gap-2.5">
          <IconWarning size={16} className="mt-px shrink-0 text-amber-500" />
          <p className="text-[12.5px] leading-relaxed text-slate-600">
            These are demo accounts holding demo money. Nothing here is connected to a real
            bank, and no statement is a real bank statement.
          </p>
        </Card>

        <p className="flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-slate-400">
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
        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-slate-400">
          Five wrong attempts lock the PIN for 15 minutes. The lockout is enforced by the
          server, not just this screen.
        </p>
      </Sheet>
    </AppShell>
  );
}
