import { useCallback, useEffect, useState } from "react";
import type { CoinSnapshot } from "../types";
import { api, errorMessage } from "../lib/api";

/**
 * The last snapshot the server sent, kept for the next mount.
 *
 * Claiming a scratch card changes the coin balance without minting a
 * transaction, so the home screen's reload key — the newest ledger row — would
 * not move and the chip would read a stale number until a full reload. The
 * scratch screen is handed the fresh snapshot the moment a claim lands, so it
 * hands it over here: the chip is then right on the frame it mounts, and its own
 * fetch only confirms it.
 */
let cached: CoinSnapshot | null = null;

export function primeCoins(snapshot: CoinSnapshot): void {
  cached = snapshot;
}

/**
 * The coin chip's data.
 *
 * Coins earned are counted from the claim on the server, so nothing here
 * computes a balance; `reloadKey` merely says when to look again — a payment
 * mints a transaction and draws a card, and scratching it is what counts.
 */
export function useCoins(reloadKey?: unknown) {
  const [coins, setCoins] = useState<CoinSnapshot | null>(cached);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // Every write to this hook's state is also a write to the cache, so whatever
  // screen last saw the truth is what the next one starts from.
  const remember = useCallback((next: CoinSnapshot | null) => {
    cached = next;
    setCoins(next);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      remember(await api.coins(signal));
      setStatus("ready");
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
      setError(errorMessage(err));
    }
  }, [remember]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  return { coins, status, error, setCoins: remember, reload: () => void load() };
}
