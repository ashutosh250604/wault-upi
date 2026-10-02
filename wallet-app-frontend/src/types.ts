/**
 * Shapes returned by the Flask API. Kept in one place so the API client, the
 * session store and every screen agree on a single contract.
 */

/**
 * `cashback` is money the rewards engine credited: a real ledger row with no
 * counterparty, because it comes from Wallet Pay rather than from a person.
 */
export type TransactionType = "topup" | "transfer" | "cashback";
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

export interface SampleLoginResponse {
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

/** A bank account the wallet can top up from. The balance is PIN-gated. */
export interface LinkedAccount {
  id: number;
  bank_name: string;
  nickname: string | null;
  holder_name: string | null;
  /** Already masked server-side, e.g. "•••• 4821". */
  masked_number: string;
  account_last4: string;
  ifsc: string | null;
  is_default: boolean;
  /** Only present after a PIN-gated balance check. */
  balance?: number;
}

export interface AccountBalanceResponse {
  account_id: number;
  balance: number;
  checked_at: string;
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

/** A payee as the directory returns them, before any money is involved. */
export interface PayeePreview {
  user_id: number;
  name: string | null;
  vpa: string | null;
  mobile: string | null;
  /** The owner's own label for them, when they are already saved. */
  nickname: string | null;
  is_saved: boolean;
}

/**
 * A row in the home "Send money to" avatar strip: everyone the user has paid,
 * followed by saved contacts who have no history yet.
 */
export interface Person {
  user_id: number;
  name: string | null;
  nickname: string | null;
  vpa: string | null;
  mobile: string | null;
  is_saved: boolean;
  is_favourite: boolean;
  /** Transfers in either direction; 0 for a contact with no history yet. */
  txn_count: number;
  total: number;
  last_amount: number | null;
  last_direction: "in" | "out" | null;
  last_note: string | null;
  last_at: string | null;
}

/** A saved payee in the user's address book. */
export interface Contact {
  id: number;
  user_id: number;
  name: string | null;
  nickname: string | null;
  vpa: string | null;
  mobile: string | null;
  is_favourite: boolean;
  last_paid_at: string | null;
}

/** A cashback credited inside the same commit as the payment that earned it. */
export interface CreditedReward {
  code: string;
  title: string;
  /** Rupees. */
  amount: number;
}

export interface TransferResponse {
  message: string;
  from: number;
  to: number;
  amount: number;
  txn_id: string;
  note: string | null;
  /** Present only when this payment completed an offer. */
  rewards?: CreditedReward[];
}

export interface TopUpResponse {
  message: string;
  new_balance: number;
  user_id: number;
  txn_id: string;
  /** Present when the top-up was funded from a linked account. */
  account?: LinkedAccount;
  /** Present when this top-up completed an offer. */
  rewards?: CreditedReward[];
}

export type NotificationKind =
  | "money_received"
  | "money_sent"
  | "topup"
  | "request_received"
  | "request_declined"
  | "reward"
  | "security";

/** One row in the inbox. A note about something that happened, never the money itself. */
export interface AppNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** Rupees, and only set for the money-shaped kinds. */
  amount: number | null;
  reference: string | null;
  is_read: boolean;
  created_at: string | null;
}

/**
 * The inbox and its badge arrive together: every screen showing the bell needs
 * the count, so asking for it twice would be a wasted round trip.
 */
export interface NotificationsResponse {
  unread_count: number;
  notifications: AppNotification[];
}

export type RewardStatus = "active" | "credited" | "expired";

/** One offer, from the catalogue in `wallet/rewards.py` plus this user's progress. */
export interface Reward {
  code: string;
  title: string;
  headline: string;
  detail: string;
  /** Rupees the offer pays out. */
  reward: number;
  target: number;
  progress: number;
  /** What progress is counted in: "payment", "top-up", "incoming payment". */
  unit: string;
  status: RewardStatus;
  started_at: string | null;
  expires_at: string | null;
  credited_at: string | null;
  /** Target met but the payout hasn't settled yet. */
  earned: boolean;
}

/** Today's spending cap, as the ledger enforces it. */
export interface LimitsResponse {
  daily_limit: number;
  spent_today: number;
  remaining: number;
  per_transaction: number;
  used_percent: number;
  /** When the cap resets — midnight IST. */
  resets_at: string;
}

export type RequestStatus = "pending" | "paid" | "declined" | "cancelled";

/** The other side of a money request, from the current user's point of view. */
export interface RequestCounterparty {
  user_id: number | null;
  name: string | null;
  vpa: string | null;
  mobile: string | null;
}

/**
 * Someone asking to be paid. `direction: "incoming"` means the ask is addressed
 * to you, i.e. somebody wants your money.
 */
export interface MoneyRequest {
  id: number;
  direction: "incoming" | "outgoing";
  status: RequestStatus;
  amount: number;
  note: string | null;
  created_at: string | null;
  resolved_at: string | null;
  counterparty: RequestCounterparty;
  /** Set once the request has been paid. */
  transfer_reference: string | null;
}

/** Response of approving a request: the receipt the result screen renders. */
export interface RequestPaymentResponse {
  message: string;
  request: MoneyRequest;
  txn_id: string;
  amount: number;
  from: number;
  to: number;
  note: string | null;
  timestamp: string;
  /** Present only when paying the request completed an offer. */
  rewards?: CreditedReward[];
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
  /** Cashback credited alongside this payment, shown as the reward line. */
  cashback?: CreditedReward[];
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
