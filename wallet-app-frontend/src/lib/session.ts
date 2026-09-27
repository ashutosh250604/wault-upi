/**
 * Session persistence. The JWT lives in localStorage because this is a
 * same-origin demo with no refresh-token endpoint; a production build handling
 * real money would use an httpOnly cookie instead.
 */

import type { Session } from "../types";

const STORAGE_KEY = "pocketpay.session.v1";

/** localStorage throws in some privacy modes — never let that crash the app. */
function storage(): Storage | null {
  try {
    const probe = "__pocketpay__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.userId === "number"
  );
}

export function readSession(): Session | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(session));
}

/** Merge new fields (e.g. the VPA returned by /set_name) into the session. */
export function patchSession(patch: Partial<Session>): Session | null {
  const current = readSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  writeSession(next);
  return next;
}

export function clearSession(): void {
  storage()?.removeItem(STORAGE_KEY);
}

export function readToken(): string | null {
  return readSession()?.token ?? null;
}

export interface TokenInfo {
  expiresAt: Date | null;
  isExpired: boolean;
  /** Whole minutes remaining, or null when the expiry can't be read. */
  minutesLeft: number | null;
}

/** Decode the (unverified) JWT payload purely to render a session countdown. */
export function inspectToken(token: string | null): TokenInfo {
  const empty: TokenInfo = { expiresAt: null, isExpired: false, minutesLeft: null };
  if (!token) return empty;
  const payload = token.split(".")[1];
  if (!payload) return empty;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = JSON.parse(window.atob(padded)) as { exp?: number };
    if (typeof decoded.exp !== "number") return empty;
    const expiresAt = new Date(decoded.exp * 1000);
    const msLeft = expiresAt.getTime() - Date.now();
    return {
      expiresAt,
      isExpired: msLeft <= 0,
      minutesLeft: Math.max(0, Math.round(msLeft / 60_000)),
    };
  } catch {
    return empty;
  }
}
