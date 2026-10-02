import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { MoneyRequest } from "../types";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { formatCurrency } from "../lib/format";
import { incomingOpen, outgoingOpen, resolved } from "../lib/requests";
import { useMoneyRequests } from "../hooks/useMoneyRequests";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { PinPad } from "../components/PinPad";
import { RequestComposerSheet, RequestRow } from "../components/Requests";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { IconPlus, IconReceipt, IconRefresh } from "../components/ui/Icons";
import { Sheet } from "../components/ui/Sheet";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState, ErrorState, TransactionSkeleton } from "../components/ui/States";

/**
 * Money requests. Paying one is a real debit, so it goes through the same PIN
 * sheet as a payment — the difference is who typed the amount.
 */
export default function RequestsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { userId, profile, patchProfile, refresh } = useAppSession();
  const { requests, status, error, reload, replace, prepend } = useMoneyRequests();

  // The pay sheet's "Ask for money" entry deep-links here with { compose: true }.
  const location = useLocation();
  const [composing, setComposing] = useState(
    () => (location.state as { compose?: boolean } | null)?.compose === true,
  );
  const [payTarget, setPayTarget] = useState<MoneyRequest | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [shakeToken, setShakeToken] = useState(0);
  const [paying, setPaying] = useState(false);

  if (!userId) return <Navigate to="/login" replace />;

  const incoming = incomingOpen(requests);
  const outgoing = outgoingOpen(requests);
  const history = resolved(requests);
  const owed = incoming.reduce((total, item) => total + item.amount, 0);
  const expected = outgoing.reduce((total, item) => total + item.amount, 0);

  const closePin = () => {
    setPayTarget(null);
    setPin("");
    setPinError(null);
  };

  const pay = async (enteredPin: string) => {
    if (!payTarget || paying) return;
    setPaying(true);
    setPinError(null);
    try {
      const result = await api.payRequest(payTarget.id, enteredPin);
      feedback.success();
      for (const reward of result.rewards ?? []) toast.success(`${reward.title} credited`);
      replace(result.request);
      if (profile) {
        patchProfile({ balance: Math.max(0, profile.balance - result.amount) });
      }
      void refresh({ silent: true });
      closePin();
      navigate("/pay/result", {
        replace: true,
        state: {
          receipt: {
            kind: "transfer",
            amount: result.amount,
            reference: result.txn_id,
            counterpartyName: result.request.counterparty.name ?? "They asked for money",
            counterpartyVpa: result.request.counterparty.vpa,
            note: result.note,
            timestamp: result.timestamp,
            cashback: result.rewards,
          },
        },
      });
    } catch (err) {
      const message = errorMessage(err);
      setPinError(message);
      setShakeToken((token) => token + 1);
      setPin("");
      feedback.warn();
      // A closed request can't be paid again, so pull the true state instead of
      // leaving a stale row with a Pay button.
      if (message.toLowerCase().includes("already")) void reload();
    } finally {
      setPaying(false);
    }
  };

  const act = async (request: MoneyRequest, action: "decline" | "cancel") => {
    setRowBusy(request.id);
    try {
      const result =
        action === "decline"
          ? await api.declineRequest(request.id)
          : await api.cancelRequest(request.id);
      replace(result);
      toast.info(result.message);
      feedback.tap();
    } catch (err) {
      toast.error(errorMessage(err));
      void reload();
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <AppShell
      header={
        <AppBar
          title="Requests"
          showBack
          right={
            <button
              type="button"
              onClick={reload}
              disabled={status === "loading"}
              aria-label="Refresh requests"
              className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
            >
              {status === "loading" ? <Spinner size={17} /> : <IconRefresh size={17} />}
            </button>
          }
        />
      }
      onRefresh={reload}
      footer={
        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            fullWidth
            leftIcon={<IconPlus size={18} />}
            onClick={() => setComposing(true)}
          >
            Ask for money
          </Button>
        </div>
      }
    >
      <div className="space-y-5 px-5 pt-4 pb-6">
        {incoming.length > 0 || outgoing.length > 0 ? (
          <Card className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                You owe
              </p>
              <p className="mt-1 text-[17px] font-bold tabular-nums text-rose-600">
                {formatCurrency(owed)}
              </p>
              <p className="mt-0.5 text-[11.5px] text-slate-400">
                {incoming.length} open ask{incoming.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="border-l border-slate-100 pl-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                Coming to you
              </p>
              <p className="mt-1 text-[17px] font-bold tabular-nums text-emerald-600">
                {formatCurrency(expected)}
              </p>
              <p className="mt-0.5 text-[11.5px] text-slate-400">
                {outgoing.length} awaiting them
              </p>
            </div>
          </Card>
        ) : null}

        {status === "error" && requests === null ? (
          <Card>
            <ErrorState message={error ?? "We couldn't load your requests."} onRetry={reload} />
          </Card>
        ) : null}

        {status === "loading" && requests === null ? (
          <Card>
            <TransactionSkeleton rows={3} />
          </Card>
        ) : null}

        {requests !== null && requests.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconReceipt size={22} />}
              title="No requests yet"
              description="Ask a contact for money — they can approve it with their PIN, or decline if it isn't right."
              action={
                <Button leftIcon={<IconPlus size={16} />} onClick={() => setComposing(true)}>
                  Ask for money
                </Button>
              }
            />
          </Card>
        ) : null}

        {incoming.length > 0 ? (
          <section className="space-y-3">
            <h2 className="px-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
              Waiting for you
            </h2>
            {incoming.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                busy={rowBusy === request.id}
                onPay={setPayTarget}
                onDecline={(item) => void act(item, "decline")}
              />
            ))}
          </section>
        ) : null}

        {outgoing.length > 0 ? (
          <section className="space-y-3">
            <h2 className="px-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
              You asked for
            </h2>
            {outgoing.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                busy={rowBusy === request.id}
                onCancel={(item) => void act(item, "cancel")}
              />
            ))}
          </section>
        ) : null}

        {history.length > 0 ? (
          <section className="space-y-3">
            <h2 className="px-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
              History
            </h2>
            {history.map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </section>
        ) : null}
      </div>

      <RequestComposerSheet
        open={composing}
        onClose={() => setComposing(false)}
        onCreated={prepend}
      />

      <Sheet
        open={payTarget !== null}
        onClose={closePin}
        title={payTarget ? `Pay ${formatCurrency(payTarget.amount)}` : "Pay request"}
        description={
          payTarget ? `To ${payTarget.counterparty.name ?? "the person who asked"}` : undefined
        }
        dismissible={!paying}
      >
        <PinPad
          value={pin}
          onChange={setPin}
          onComplete={(entered) => void pay(entered)}
          error={pinError}
          shakeToken={shakeToken}
          busy={paying}
          busyLabel="Paying request…"
          autoSubmit={!paying}
        />
        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-slate-400">
          Approving sends the money immediately. The PIN is checked on the server before the
          debit, and the request closes in the same transaction as the payment.
        </p>
      </Sheet>
    </AppShell>
  );
}
