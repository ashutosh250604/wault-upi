import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { useToast } from "./toast";

export interface ResolvedPayee {
  user_id: number;
  name: string | null;
  vpa: string;
}

export interface IncludeOptions {
  amount?: number;
  note?: string;
}

/**
 * Turns a typed UPI ID into a payment: verifies the payee exists, then hands off
 * to the amount screen with the resolved name. Shared by the scanner, the pay
 * sheet and (later) the people picker so the flow can't drift between them.
 */
export function usePayeeResolution() {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(
    async (identifier: string, options: IncludeOptions = {}): Promise<boolean> => {
      const vpa = identifier.trim().toLowerCase();
      setBusy(true);
      setError(null);
      try {
        const resolved: ResolvedPayee = await api.resolveVpa(vpa);
        feedback.success();
        navigate("/pay/amount", {
          state: {
            mode: "transfer",
            receiverId: resolved.user_id,
            receiverName: resolved.name,
            receiverVpa: resolved.vpa,
            suggestedAmount: options.amount,
            note: options.note,
          },
        });
        return true;
      } catch (err) {
        const message = errorMessage(err);
        setError(message);
        feedback.warn();
        toast.error(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [navigate, toast],
  );

  return { resolve, busy, error, clearError: () => setError(null) };
}
