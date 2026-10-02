import { useCallback, useEffect, useState } from "react";
import type { Reward } from "../types";
import { api, errorMessage } from "../lib/api";

/**
 * The offers strip's data.
 *
 * Progress is counted server-side from the ledger, so nothing here computes it;
 * `reloadKey` just says when to look again — a payment can complete an offer, and
 * every payment mints a transaction.
 */
export function useRewards(reloadKey?: unknown) {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setRewards(await api.rewards(signal));
      setStatus("ready");
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  return { rewards, status, error, reload: () => void load() };
}
