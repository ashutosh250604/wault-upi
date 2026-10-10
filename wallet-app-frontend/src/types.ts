/**
 * Shapes returned by the Flask API. Kept in one place so the API client, the
 * session store and every screen agree on a single contract.
 */

/**
 * `coins` is a coin redemption: real money, with no counterparty, because it
 * comes from WAULT rather than from a person. `cashback` is the same thing by an
 * older route — offers used to credit rupees straight into the balance and now
 * pay coins instead, so this type still exists to render the rows already in
 * people's histories.
 */
export type TransactionType = "topup" | "transfer" | "cashback" | "coins";
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
  /**
   * How many of the free resend requests are left before the wait starts.
   * Zero means the next request is the one that has to wait.
   */
  requests_remaining?: number;
  /**
   * The instant the next OTP may be requested, as an ISO timestamp — null
   * while requests are still free. The verify screen's countdown runs on this
   * rather than on a window of its own, so it survives a refresh and agrees
   * with the server that will enforce it.
   */
  resend_available_at?: string | null;
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

/**
 * The coin scheme, as the header chip and the rewards sheet render it.
 *
 * `coins` earned are counted from the ledger server-side, so nothing here is
 * computed on the client and two screens can't disagree.
 */
export interface CoinSnapshot {
  /** Coins in hand. */
  coins: number;
  /** What those coins are worth in rupees. */
  value: number;
  /** Lifetime coins drawn from payments. */
  earned: number;
  /** Lifetime coins spent. */
  redeemed: number;
  /** What one coin is worth. */
  coin_value: number;
  /** The smallest payout, in coins. */
  min_redeem: number;
  /**
   * How many scratch cards are still under a cover. A count and never a total:
   * what an unopened card is worth is the one thing the wallet will not say
   * before it is scratched, so the chip can point at them without spoiling them.
   */
  cards_waiting: number;
  /** The largest payout available right now, in coins (0 below the minimum). */
  redeemable: number;
  redeemable_value: number;
  /**
   * What the last few awards paid out, newest first — a payment's draw, the
   * welcome bonus, or an offer. `label` is the server's wording for `reason`,
   * so "where did these coins come from" has one answer rather than one per
   * screen.
   */
  awards: Array<{ coins: number; reason: string; label: string; at: string }>;
}

/** The result of spending coins: the credit, and the coins left over. */
export interface CoinsRedeemedResponse {
  message: string;
  coins_redeemed: number;
  amount: number;
  new_balance: number | null;
  txn_id: string;
  coins: CoinSnapshot;
}

/**
 * An offer paid inside the same commit as the payment that completed it.
 *
 * Offers pay in coins, so `coins` is the payout and `amount` is what those
 * coins are worth — the same figure, because a coin redeems at ₹1, but sent by
 * the server rather than assumed here.
 */
export interface CreditedReward {
  code: string;
  title: string;
  /** The promise in words ("On your first top-up"), without its number. */
  headline?: string;
  coins: number;
  /** Rupees the coins are worth. */
  amount: number;
}

export interface TransferResponse {
  message: string;
  from: number;
  to: number;
  amount: number;
  txn_id: string;
  note: string | null;
  /**
   * Set when this payment drew a scratch card. The draw's *amount* is not in
   * this payload: it lives in the card and arrives when the card is scratched.
   */
  scratch_card_waiting?: boolean;
  /** The scratch card this payment drew, so its receipt can open the same one. */
  coin_card_id?: number;
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
  | "scratch_card"
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
  /** Coins the offer pays out — every offer pays in coins. */
  coins: number;
  /** Rupees those coins are worth. */
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
  /** Set when this payment drew a scratch card — see `TransferResponse`. */
  scratch_card_waiting?: boolean;
  /** The scratch card this payment drew, so its receipt can open the same one. */
  coin_card_id?: number;
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
  /**
   * True when this payment drew a scratch card. A flag and not an amount: the
   * receipt says a card is waiting, and what it is worth stays under the cover
   * until the card itself is scratched.
   */
  scratchCardWaiting?: boolean;
}

/**
 * One scratch card: a coin award, and whether its cover has been lifted.
 *
 * The coins are the user's own — credited the moment they were won — so they
 * travel with the card rather than being withheld: the cover is the screen's
 * device, not a secret, and the card never shows them until it is lifted.
 * `scratched` is what the collection remembers, so a card that has been opened
 * comes back open.
 */
export interface ScratchCard {
  id: number;
  /** When the card was won. */
  at: string;
  /** What won it: "payment", "signup" or "offer:<code>". */
  reason: string;
  /** What won it, in a line — the fallback caption for a card with no payment. */
  caption: string;
  /**
   * What the card paid, or null while it is still under its cover. The amount
   * is decided and stored server-side the moment the card is won, and it is
   * deliberately absent from this payload until the card is claimed — so a
   * covered card has nothing to reveal, in the response or on the screen.
   */
  coins: number | null;
  scratched: boolean;
  scratched_at: string | null;
  /** The payment's reference, so a card can be traced to its receipt. */
  reference: string | null;
  /** Who the payment went to, when the payment is still on record. */
  paid_to: string | null;
  amount: number | null;
  note: string | null;
}

/** The whole collection, newest first. */
export interface ScratchCardCollection {
  cards: ScratchCard[];
  total: number;
  unscratched: number;
}

/**
 * The answer to scratching one card.
 *
 * `credited` is what the claim added to the coin balance — 0 for a card that
 * had already been claimed, which is how a repeat scratch is told apart from a
 * payout — and `coins` is the fresh snapshot, so the header chip moves with the
 * reveal rather than a round trip behind it.
 */
export interface ScratchCardClaimResponse {
  card: ScratchCard;
  credited: number;
  coins: CoinSnapshot;
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
