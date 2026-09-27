/**
 * Shapes returned by the Flask API. Kept in one place so the API client, the
 * session store and every screen agree on a single contract.
 */

export type TransactionType = "topup" | "transfer";
export type TransactionStatus = "success" | "pending" | "failed";

/** What we persist in localStorage after a successful sign-in. */
export interface Session {
  token: string;
  userId: number;
  mobile: string | null;
  name: string | null;
  vpa: string | null;
}

export interface WalletTransaction {
  id: number;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  sender: number | null;
  receiver: number | null;
  sender_name: string | null;
  receiver_name: string | null;
  /** Rupees, not paise — the API converts before sending. */
  amount: number;
  note: string | null;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
}

export interface HealthResponse {
  status: string;
  demo_mode: boolean;
  db: string;
  driver: string;
}

export interface StartLoginResponse {
  message: string;
  /** Present only when the server runs with DEMO_MODE=true. */
  dev_otp?: string;
}

export interface VerifyOtpResponse {
  message: string;
  token: string;
  user_id: number;
  name: string | null;
  vpa: string | null;
  ask_name: boolean;
}

export interface DemoLoginResponse {
  message: string;
  token: string;
  user_id: number;
  mobile: string;
  name: string | null;
  vpa: string | null;
  balance: number;
}

export interface SetNameResponse {
  message: string;
  user_id: number;
  vpa: string;
}

export interface MeResponse {
  user_id: number;
  mobile: string;
  name: string | null;
  vpa: string | null;
  is_verified: boolean;
  balance: number;
  /** False while an account has a name but no PIN yet. */
  has_pin: boolean;
}

export interface BalanceResponse {
  user_id: number;
  balance: number;
}

export interface ResolvedVpa {
  user_id: number;
  name: string | null;
  vpa: string;
}

export interface TransferResponse {
  message: string;
  from: number;
  to: number;
  amount: number;
  txn_id: string;
  note: string | null;
}

export interface TopUpResponse {
  message: string;
  new_balance: number;
  user_id: number;
  txn_id: string;
}

/** Everything the receipt screen needs, carried through router state. */
export interface Receipt {
  kind: "transfer" | "topup";
  amount: number;
  reference: string;
  counterpartyName: string;
  counterpartyVpa: string | null;
  note: string | null;
  timestamp: string;
}

/** Router state for the amount-entry screen. */
export interface PaymentIntent {
  mode: "transfer" | "topup";
  receiverId?: number;
  receiverName?: string | null;
  receiverVpa?: string | null;
  /** Pre-filled amount, e.g. when a QR code carried an `am=` parameter. */
  suggestedAmount?: number;
  note?: string;
}
