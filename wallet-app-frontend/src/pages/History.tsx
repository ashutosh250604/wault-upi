import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { WalletTransaction } from "../types";
import { cx } from "../lib/cx";
import { formatCurrency } from "../lib/format";
import { classifyTransaction } from "../lib/transactions";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { StatementDownload } from "../components/StatementDownload";
import { TransactionDetailSheet, TransactionList } from "../components/Transactions";
import { Card } from "../components/ui/Card";
import { IconRefresh } from "../components/ui/Icons";
import { ErrorState } from "../components/ui/States";
import { Spinner } from "../components/ui/Spinner";

type Filter = "all" | "in" | "out";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "in", label: "Money in" },
  { key: "out", label: "Money out" },
];

export default function HistoryPage() {
  const { userId, transactions, status, error, refresh } = useAppSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<WalletTransaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { visible, totals } = useMemo(() => {
    const list = transactions ?? [];
    const id = userId ?? -1;
    let moneyIn = 0;
    let moneyOut = 0;

    for (const transaction of list) {
      const item = classifyTransaction(transaction, id);
      if (item.direction === "in") moneyIn += transaction.amount;
      else moneyOut += transaction.amount;
    }

    const filtered =
      filter === "all"
        ? list
        : list.filter(
            (transaction) =>
              classifyTransaction(transaction, id).direction === filter,
          );

    return { visible: filtered, totals: { moneyIn, moneyOut } };
  }, [transactions, userId, filter]);

  if (!userId) return <Navigate to="/login" replace />;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh({ silent: true });
    setRefreshing(false);
  };

  return (
    <AppShell
      nav
      onRefresh={() => void onRefresh()}
      header={
        <AppBar
          title="Transactions"
          right={
            // A capsule, not a floating icon: the same refresh control as the
            // balance on the home hero, so the two read as one idea.
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              aria-label="Refresh transactions"
              className="mr-0.5 inline-flex items-center gap-1.5 rounded-[7px] bg-paper-100 px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 ring-[1.5px] ring-ink-900/70 ring-inset transition hover:bg-paper-200 active:bg-paper-300 disabled:opacity-60"
            >
              {refreshing ? <Spinner size={13} /> : <IconRefresh size={13} />}
              Refresh
            </button>
          }
        />
      }
    >
      <div className="space-y-5 px-5 pt-4 pb-6">
        {/* The day's totals read like a printed summary line, not two boxes. */}
        <div className="grid grid-cols-2 divide-x divide-ink-200 rounded-[10px] border-[1.5px] border-ink-900/75 bg-paper-25 px-4 py-3.5">
          <div className="pr-3">
            <p className="text-[12px] font-medium text-ink-500">Money in</p>
            <p className="mt-1 font-display text-[19px] leading-none font-extrabold tracking-[-0.02em] tabular-nums text-credit-600">
              {formatCurrency(totals.moneyIn)}
            </p>
          </div>
          <div className="pl-4">
            <p className="text-[12px] font-medium text-ink-500">Money out</p>
            <p className="mt-1 font-display text-[19px] leading-none font-extrabold tracking-[-0.02em] tabular-nums text-ink-900">
              {formatCurrency(totals.moneyOut)}
            </p>
          </div>
        </div>

        <StatementDownload fullWidth />

        <div
          className="flex gap-5 border-b border-ink-200"
          role="tablist"
          aria-label="Filter transactions"
        >
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(item.key)}
                className={cx(
                  "-mb-px border-b-2 px-0.5 pb-2 text-[13px] font-semibold transition",
                  "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
                  active
                    ? "border-ink-900 text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-700",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {status === "error" && transactions === null ? (
          <Card>
            <ErrorState
              message={error ?? "We couldn't load your transactions."}
              onRetry={() => void onRefresh()}
            />
          </Card>
        ) : (
          <TransactionList
            transactions={visible}
            userId={userId}
            onSelect={setSelected}
            emptyTitle={filter === "all" ? "No transactions yet" : "Nothing here yet"}
            emptyDescription={
              filter === "in"
                ? "Money you receive or top up will show up here."
                : filter === "out"
                  ? "Payments you make will show up here."
                  : "Top up your wallet or pay someone to see it here."
            }
          />
        )}
      </div>

      <TransactionDetailSheet
        transaction={selected}
        userId={userId}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </AppShell>
  );
}
