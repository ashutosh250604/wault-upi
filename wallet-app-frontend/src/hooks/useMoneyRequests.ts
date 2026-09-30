import { useCallback, useEffect, useState } from "react";
import type { MoneyRequest } from "../types";
import { api, errorMessage } from "../lib/api";
import type { RequestsStatus } from "../lib/requests";

/**
 * Owns the request list. Shared by the Requests screen and the home banner so
 * both read the same data and a single reload refreshes every view of it.
 */
export function useMoneyRequests(reloadKey?: unknown) {
  const [requests, setRequests] = useState<MoneyRequest[] | null>(null);
  const [status, setStatus] = useState<RequestsStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await api.requests(signal);
      setRequests(list);
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

  return {
    requests,
    status,
    error,
    reload: () => void load(),
    /** Replace one row in place after it was paid, declined or cancelled. */
    replace: (updated: MoneyRequest) =>
      setRequests((current) =>
        (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
      ),
    prepend: (created: MoneyRequest) =>
      setRequests((current) => {
        const list = current ?? [];
        return list.some((item) => item.id === created.id)
          ? list.map((item) => (item.id === created.id ? created : item))
          : [created, ...list];
      }),
  };
}
