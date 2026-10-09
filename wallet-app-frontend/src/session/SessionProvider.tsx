import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage, onAuthFailure } from "../lib/api";
import {
  clearSession,
  inspectToken,
  patchSession,
  readSession,
  writeSession,
} from "../lib/session";
import type { MeResponse, Session, WalletTransaction } from "../types";
import { useToast } from "../hooks/toast";
import { AppSessionContext, type AppSessionValue, type LoadStatus } from "./context";

/**
 * Owns the session, the cached profile and the cached transaction list.
 *
 * Also the only place that reacts to a 401: api.ts notifies it, and it clears
 * the session and routes to /login exactly once, so an expired token can't
 * leave the UI half-signed-in mid-payment.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [session, setSession] = useState<Session | null>(() => readSession());
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef<AbortController | null>(null);
  const hasData = useRef(false);
  hasData.current = profile !== null;

  const signOut = useCallback(
    (message?: string) => {
      inFlight.current?.abort();
      clearSession();
      setSession(null);
      setProfile(null);
      setTransactions(null);
      setStatus("idle");
      setError(null);
      if (message) toast.info(message);
      navigate("/login", { replace: true });
    },
    [navigate, toast],
  );

  // api.ts calls this on any 401; ignore it if we're already signed out.
  useEffect(() => {
    onAuthFailure(() => {
      if (!readSession()) return;
      signOut("Your session expired. Please sign in again.");
    });
    return () => onAuthFailure(null);
  }, [signOut]);

  // A session lasts 30 minutes and the client counts the same window down.
  //
  // The token is the source of truth — the server refuses anything past `exp` —
  // so waiting for a 401 would mean finding out mid-payment, with the screen
  // half-rendered around a wallet that is already closed. Instead the app ends
  // the session the moment it lapses and says why.
  useEffect(() => {
    if (!session) return;
    const { expiresAt } = inspectToken(session.token);
    // A token whose expiry can't be read is not evidence of a lapsed session;
    // the 401 handler above is the backstop for those.
    if (!expiresAt) return;

    const lapse = () =>
      signOut("Your 30-minute session has ended. Please sign in again.");
    const msLeft = expiresAt.getTime() - Date.now();
    if (msLeft <= 0) {
      lapse();
      return;
    }
    const timer = window.setTimeout(lapse, msLeft);
    return () => window.clearTimeout(timer);
  }, [session, signOut]);

  const refresh = useCallback<AppSessionValue["refresh"]>(async (options) => {
    const current = readSession();
    if (!current) return;
    const silent = options?.silent ?? false;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    if (!silent) {
      setStatus("loading");
      setError(null);
    }

    try {
      const [me, history] = await Promise.all([
        api.me(controller.signal),
        api.transactions(current.userId, controller.signal),
      ]);
      setProfile(me);
      setTransactions(history);
      setStatus("ready");
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = errorMessage(err);
      if (hasData.current) {
        // Keep showing what we have; just flag the failed refresh.
        setStatus("ready");
        toast.error(message);
      } else {
        setStatus("error");
        setError(message);
      }
    }
  }, [toast]);

  // Load once per signed-in user (sign-in, page reload, account switch).
  const userId = session?.userId ?? null;
  useEffect(() => {
    if (userId === null) return;
    void refresh();
  }, [userId, refresh]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const value = useMemo<AppSessionValue>(
    () => ({
      session,
      userId,
      isAuthenticated: session !== null,
      signIn: (next: Session) => {
        writeSession(next);
        setSession(next);
      },
      updateSession: (patch: Partial<Session>) => {
        const next = patchSession(patch);
        if (next) setSession(next);
      },
      signOut,
      profile,
      transactions,
      status,
      error,
      refresh,
      patchProfile: (patch: Partial<MeResponse>) =>
        setProfile((current) => (current ? { ...current, ...patch } : current)),
    }),
    [session, userId, signOut, profile, transactions, status, error, refresh],
  );

  return (
    <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>
  );
}
