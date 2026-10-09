import { useCallback, useEffect, useState } from "react";
import type { CoinSnapshot } from "../types";
import { api, errorMessage } from "../lib/api";

/**
 * The coin chip's data.
 *
 * Coins earned are counted from the ledger on the server, so nothing here
 * computes a balance; `reloadKey` merely says when to look again — every payment
 * mints a transaction, and every third one pays a coin.
 */
export function useCoins(reloadKey?: unknown) {
  const [coins, setCoins] = useState<CoinSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setCoins(await api.coins(signal));
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

  return { coins, status, error, setCoins, reload: () => void load() };
}
