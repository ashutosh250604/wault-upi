import { useCallback, useEffect, useState } from "react";
import type { Person } from "../types";
import { api, errorMessage } from "../lib/api";
import type { PeopleStatus } from "../lib/people";

/**
 * Fetches the home avatar row: people paid recently, then saved contacts.
 * `reloadKey` lets a parent refetch it when something payment-shaped happened —
 * the newest transaction's id is a good key, since paying someone mints one.
 */
export function useRecentPeople(limit = 8, reloadKey?: unknown) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [status, setStatus] = useState<PeopleStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const list = await api.recentPeople(limit, signal);
        setPeople(list);
        setStatus("ready");
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setError(errorMessage(err));
      }
    },
    [limit],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  return { people, status, error, reload: () => void load() };
}
