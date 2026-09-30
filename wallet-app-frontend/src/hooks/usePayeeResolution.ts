import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { payeeIdentifierError } from "../lib/validation";
import { useToast } from "./toast";

/** The minimum a caller must know to start a payment. */
export interface PayablePerson {
  user_id: number;
  name: string | null;
  vpa: string | null;
  mobile?: string | null;
}

export interface IncludeOptions {
  amount?: number;
  note?: string;
}

/**
 * Turns a typed UPI ID or mobile number into a payment: the identifier is
 * checked locally, verified against the directory, then handed to the amount
 * screen with the resolved name. Shared by the scanner, the pay sheet, the
 * contacts book and the home avatar row so the flow can't drift between them.
 */
export function usePayeeResolution() {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Start a payment to someone we already know (a contact, a recent payee). */
  const startPayment = useCallback(
    (payee: PayablePerson, options: IncludeOptions = {}) => {
      navigate("/pay/amount", {
        state: {
          mode: "transfer",
          receiverId: payee.user_id,
          receiverName: payee.name,
          receiverVpa: payee.vpa,
          suggestedAmount: options.amount,
          note: options.note,
        },
      });
    },
    [navigate],
  );

  const resolve = useCallback(
    async (identifier: string, options: IncludeOptions = {}): Promise<boolean> => {
      const problem = payeeIdentifierError(identifier);
      if (problem) {
        setError(problem);
        feedback.warn();
        return false;
      }

      setBusy(true);
      setError(null);
      try {
        const payee = await api.resolvePayee(identifier.trim());
        feedback.success();
        startPayment(payee, options);
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
    [startPayment, toast],
  );

  return { resolve, startPayment, busy, error, clearError: () => setError(null) };
}
