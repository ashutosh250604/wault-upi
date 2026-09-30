import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { WalletTransaction } from "../types";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { saveBlob } from "../lib/download";
import { formatCurrency } from "../lib/format";
import { useToast } from "../hooks/toast";
import { classifyTransaction } from "../lib/transactions";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { TransactionDetailSheet, TransactionList } from "../components/Transactions";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { IconDownload, IconRefresh } from "../components/ui/Icons";
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
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<WalletTransaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  const exportStatement = async () => {
    setExporting(true);
    try {
      // The server builds the CSV from the ledger, so the download can't drift
      // from the rows on screen.
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
      nav
      onRefresh={() => void onRefresh()}
      header={
        <AppBar
          title="Transactions"
          right={
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              aria-label="Refresh transactions"
              className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
            >
              {refreshing ? <Spinner size={17} /> : <IconRefresh size={17} />}
            </button>
          }
        />
      }
    >
      <div className="space-y-5 px-5 pt-4 pb-6">
        <Card className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Money in
            </p>
            <p className="mt-1 text-[17px] font-bold tabular-nums text-emerald-600">
              {formatCurrency(totals.moneyIn)}
            </p>
          </div>
          <div className="border-l border-slate-100 pl-3">
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Money out
            </p>
            <p className="mt-1 text-[17px] font-bold tabular-nums text-slate-900">
              {formatCurrency(totals.moneyOut)}
            </p>
          </div>
        </Card>

        <Button
          variant="secondary"
          fullWidth
          size="sm"
          loading={exporting}
          leftIcon={<IconDownload size={15} />}
          onClick={() => void exportStatement()}
        >
          Download statement (CSV)
        </Button>

        <div
          className="flex gap-1.5 rounded-2xl bg-slate-100 p-1.5"
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
                  "flex-1 rounded-xl py-2 text-[12.5px] font-semibold transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
                  active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
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
