import { createContext, useContext } from "react";
import type { MeResponse, Session, WalletTransaction } from "../types";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * One place for "who is signed in" and "what does their wallet look like".
 * Screens read from here instead of each firing their own /me + /transactions
 * pair, so navigation between tabs costs no extra requests.
 */
export interface AppSessionValue {
  session: Session | null;
  userId: number | null;
  isAuthenticated: boolean;

  signIn: (session: Session) => void;
  updateSession: (patch: Partial<Session>) => void;
  /** Clears local state; pass a message to explain why to the user. */
  signOut: (message?: string) => void;

  profile: MeResponse | null;
  transactions: WalletTransaction[] | null;
  status: LoadStatus;
  error: string | null;
  /** Reloads profile + transactions. `silent` keeps the current UI on screen. */
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  /** Locally patch the cached balance after a payment settles. */
  setBalance: (balance: number) => void;
}

export const AppSessionContext = createContext<AppSessionValue | null>(null);

export function useAppSession(): AppSessionValue {
  const value = useContext(AppSessionContext);
  if (!value) throw new Error("useAppSession must be used inside <SessionProvider>");
  return value;
}
