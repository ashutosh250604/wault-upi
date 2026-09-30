/**
 * The single place that talks to the Flask API.
 *
 * Every call funnels through `request()`, which normalises errors into
 * `ApiError`, turns network failures into something a human can read, and
 * reports 401s to the app so it can sign the user out exactly once.
 */

import type {
  BalanceResponse,
  Contact,
  DemoLoginResponse,
  HealthResponse,
  MeResponse,
  PayeePreview,
  MoneyRequest,
  Person,
  RequestPaymentResponse,
  ResolvedVpa,
  SetNameResponse,
  StartLoginResponse,
  TopUpResponse,
  TransferResponse,
  VerifyOtpResponse,
  WalletTransaction,
} from "../types";
import { readToken } from "./session";
import { messageForStatus } from "./validation";

/**
 * Same origin in production (Flask serves the built SPA); the dev server reads
 * VITE_API_BASE from .env.development.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/**
 * Every JSON endpoint lives under /api, which keeps the API from ever
 * shadowing a client route: `/requests` is a screen, `/api/requests` is data.
 * Paths below stay relative to this.
 */
const API_PREFIX = "/api";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the failure was a dead connection rather than an API response. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

type AuthFailureListener = () => void;
let authFailureListener: AuthFailureListener | null = null;

/**
 * Called once per 401 so the app can clear the session and bounce to /login.
 * Registered by <App /> rather than imported from the router, which keeps this
 * module free of React and router dependencies.
 */
export function onAuthFailure(listener: AuthFailureListener | null): void {
  authFailureListener = listener;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Attach the Bearer token; throws early when there isn't one. */
  auth?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = false, signal } = options;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = readToken();
    if (!token) throw new ApiError("Your session expired. Please sign in again.", 401);
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // An aborted request is a component unmounting, not a failure to report.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      "Can't reach the server. Check your connection and try again.",
      0,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload as { message?: string } | null)?.message ?? messageForStatus(response.status);
    if (response.status === 401) authFailureListener?.();
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

/** Error text for any thrown value, for use in catch blocks. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>("/healthz", { signal }),

  startLogin: (mobile: string, signal?: AbortSignal) =>
    request<StartLoginResponse>("/start_login", {
      method: "POST",
      body: { mobile },
      signal,
    }),

  verifyOtp: (mobile: string, otp: string, signal?: AbortSignal) =>
    request<VerifyOtpResponse>("/verify_otp", {
      method: "POST",
      body: { mobile, otp },
      signal,
    }),

  demoLogin: (signal?: AbortSignal) =>
    request<DemoLoginResponse>("/demo_login", { method: "POST", signal }),

  setName: (name: string, email: string, signal?: AbortSignal) =>
    request<SetNameResponse>("/set_name", {
      method: "POST",
      body: { name, email },
      auth: true,
      signal,
    }),

  setPin: (pin: string, signal?: AbortSignal) =>
    request<{ message: string }>("/set_pin", {
      method: "POST",
      body: { pin },
      auth: true,
      signal,
    }),

  verifyPin: (pin: string, signal?: AbortSignal) =>
    request<{ message: string }>("/verify_pin", {
      method: "POST",
      body: { pin },
      auth: true,
      signal,
    }),

  me: (signal?: AbortSignal) => request<MeResponse>("/me", { auth: true, signal }),

  balance: (userId: number, signal?: AbortSignal) =>
    request<BalanceResponse>(`/get_balance/${userId}`, { auth: true, signal }),

  transactions: (userId: number, signal?: AbortSignal) =>
    request<WalletTransaction[]>(`/transactions/${userId}`, { auth: true, signal }),

  topUp: (userId: number, amount: number, signal?: AbortSignal) =>
    request<TopUpResponse>("/topup", {
      method: "POST",
      body: { user_id: userId, amount },
      auth: true,
      signal,
    }),

  /**
   * Sends money. The PIN travels with the request so the server authorises the
   * debit itself, rather than trusting a separate "PIN was fine" call.
   */
  transfer: (
    receiverId: number,
    amount: number,
    note: string | null,
    pin: string,
    signal?: AbortSignal,
  ) =>
    request<TransferResponse>("/transfer", {
      method: "POST",
      body: { receiver_id: receiverId, amount, note: note || undefined, pin },
      auth: true,
      signal,
    }),

  requests: (signal?: AbortSignal) =>
    request<MoneyRequest[]>("/requests", { auth: true, signal }),

  createRequest: (
    target: { payerId: number } | { identifier: string },
    amount: number,
    note: string | null,
    signal?: AbortSignal,
  ) =>
    request<MoneyRequest & { message: string }>("/requests", {
      method: "POST",
      body: {
        ...("payerId" in target
          ? { payer_id: target.payerId }
          : { identifier: target.identifier }),
        amount,
        note: note || undefined,
      },
      auth: true,
      signal,
    }),

  payRequest: (requestId: number, pin: string, signal?: AbortSignal) =>
    request<RequestPaymentResponse>(`/requests/${requestId}/pay`, {
      method: "POST",
      body: { pin },
      auth: true,
      signal,
    }),

  declineRequest: (requestId: number, signal?: AbortSignal) =>
    request<MoneyRequest & { message: string }>(`/requests/${requestId}/decline`, {
      method: "POST",
      auth: true,
      signal,
    }),

  cancelRequest: (requestId: number, signal?: AbortSignal) =>
    request<MoneyRequest & { message: string }>(`/requests/${requestId}/cancel`, {
      method: "POST",
      auth: true,
      signal,
    }),

  resolveVpa: (vpa: string, signal?: AbortSignal) =>
    request<ResolvedVpa>("/vpas/resolve", {
      method: "POST",
      body: { vpa },
      auth: true,
      signal,
    }),

  /** Resolves a UPI ID *or* a mobile number to the wallet behind it. */
  resolvePayee: (identifier: string, signal?: AbortSignal) =>
    request<PayeePreview>("/payees/resolve", {
      method: "POST",
      body: { identifier },
      auth: true,
      signal,
    }),

  recentPeople: (limit = 8, signal?: AbortSignal) =>
    request<Person[]>(`/people/recent?limit=${limit}`, { auth: true, signal }),

  contacts: (signal?: AbortSignal) => request<Contact[]>("/contacts", { auth: true, signal }),

  addContact: (
    identifier: string,
    options: { nickname?: string; favourite?: boolean } = {},
    signal?: AbortSignal,
  ) =>
    request<Contact & { message: string }>("/contacts", {
      method: "POST",
      body: {
        identifier,
        nickname: options.nickname || undefined,
        is_favourite: options.favourite ?? false,
      },
      auth: true,
      signal,
    }),

  updateContact: (
    contactId: number,
    patch: { nickname?: string | null; is_favourite?: boolean },
    signal?: AbortSignal,
  ) =>
    request<Contact>(`/contacts/${contactId}`, {
      method: "PATCH",
      body: patch,
      auth: true,
      signal,
    }),

  removeContact: (contactId: number, signal?: AbortSignal) =>
    request<{ message: string }>(`/contacts/${contactId}`, {
      method: "DELETE",
      auth: true,
      signal,
    }),
};
