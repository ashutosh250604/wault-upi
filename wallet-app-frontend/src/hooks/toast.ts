import { createContext, useContext } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

export interface ToastApi {
  notify: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
