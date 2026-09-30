import { useEffect, useState } from "react";
import type { MoneyRequest } from "../types";
import { api, errorMessage } from "../lib/api";
import { avatarToneFor } from "../lib/avatar";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { formatCurrency, formatDateTime, formatTime } from "../lib/format";
import { personLabel } from "../lib/people";
import { STATUS_LABELS, incomingOpen, requestSubtitle } from "../lib/requests";
import { MAX_TRANSFER_RUPEES, amountError, toRupees } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { useRecentPeople } from "../hooks/useRecentPeople";
import { PeopleStrip } from "./People";
import { Avatar, Badge } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, TextArea, TextInput } from "./ui/Field";
import { IconCheck, IconChevronRight, IconInfo, IconNote, IconWarning } from "./ui/Icons";
import { Sheet } from "./ui/Sheet";

const QUICK_AMOUNTS = [100, 250, 500, 1000];

const STATUS_TONES = {
  pending: "brand",
  paid: "success",
  declined: "neutral",
  cancelled: "neutral",
} as const;

export interface RequestRowProps {
  request: MoneyRequest;
  /** Disables this row's actions while its own request is in flight. */
  busy?: boolean;
  onPay?: (request: MoneyRequest) => void;
  onDecline?: (request: MoneyRequest) => void;
  onCancel?: (request: MoneyRequest) => void;
  className?: string;
}

/** One ask, with the actions that ask allows for the side you're on. */
export function RequestRow({
  request,
  busy = false,
  onPay,
  onDecline,
  onCancel,
  className,
}: RequestRowProps) {
  const other = request.counterparty;
  const label = other.name ?? "PocketPay user";
  const isOpen = request.status === "pending";

  return (
    <Card className={cx("space-y-3", className)}>
      <div className="flex items-start gap-3">
        <Avatar
          name={label}
          size="lg"
          tone={avatarToneFor(other.vpa ?? other.mobile ?? String(other.user_id))}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-snug text-slate-600">
            {request.direction === "incoming" ? (
              <>
                <span className="font-semibold text-slate-900">{label}</span> asked you for
                money
              </>
            ) : (
              <>
                You asked <span className="font-semibold text-slate-900">{label}</span>
              </>
            )}
          </p>
          <p className="mt-1 text-[20px] leading-none font-bold tabular-nums text-slate-900">
            {formatCurrency(request.amount)}
          </p>
          <p className="mt-1.5 text-[11.5px] text-slate-400">
            {formatTime(request.created_at ?? new Date().toISOString())} ·{" "}
            {requestSubtitle(request)}
          </p>
        </div>
        <Badge tone={STATUS_TONES[request.status]}>{STATUS_LABELS[request.status]}</Badge>
      </div>

      {request.note ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600">
          “{request.note}”
        </p>
      ) : null}

      {isOpen ? (
        <div className="flex gap-2">
          {request.direction === "incoming" ? (
            <>
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onClick={() => onDecline?.(request)}
              >
                Decline
              </Button>
              <Button fullWidth disabled={busy} onClick={() => onPay?.(request)}>
                Pay {formatCurrency(request.amount)}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              disabled={busy}
              onClick={() => onCancel?.(request)}
            >
              Cancel request
            </Button>
          )}
        </div>
      ) : request.status === "paid" && request.resolved_at ? (
        <p className="text-[11.5px] text-slate-400">
          Settled {formatDateTime(request.resolved_at)}
        </p>
      ) : null}
    </Card>
  );
}

export interface RequestsBannerProps {
  requests: MoneyRequest[];
  onOpen: () => void;
  className?: string;
}

/**
 * The nudge that turns an ask into an answer: one line on the home screen when
 * somebody is waiting on you. Renders nothing when nobody is.
 */
export function RequestsBanner({ requests, onOpen, className }: RequestsBannerProps) {
  const waiting = incomingOpen(requests);
  if (waiting.length === 0) return null;

  const [first] = waiting;
  const total = waiting.reduce((sum, item) => sum + item.amount, 0);
  const other = first.counterparty;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "flex w-full items-center gap-3 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-fuchsia-50/60 p-3.5 text-left transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        className,
      )}
    >
      <Avatar
        name={other.name}
        size="lg"
        tone={avatarToneFor(other.vpa ?? other.mobile ?? String(other.user_id))}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-brand-900">
          {other.name ?? "Someone"} asked you for {formatCurrency(first.amount)}
        </span>
        <span className="block text-[12px] leading-snug text-brand-900/70">
          {waiting.length > 1
            ? `${waiting.length} requests waiting · ${formatCurrency(total)} in total`
            : "Tap to review, then pay it with your PIN"}
        </span>
      </span>
      <IconChevronRight size={17} className="shrink-0 text-brand-700" />
    </button>
  );
}

export interface RequestComposerSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: (request: MoneyRequest) => void;
}

interface Target {
  user_id: number;
  name: string | null;
  vpa: string | null;
}

/**
 * "Ask someone for money": pick a recent face or look somebody up, type an
 * amount, and send. Mirrors the pay sheet's person-first flow so asking and
 * paying don't feel like two different products.
 */
export function RequestComposerSheet({ open, onClose, onCreated }: RequestComposerSheetProps) {
  const toast = useToast();
  const { people, status, reload } = useRecentPeople(10);

  const [target, setTarget] = useState<Target | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [lookupIssue, setLookupIssue] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) return;
    setTarget(null);
    setIdentifier("");
    setLookupIssue(null);
    setAmount("");
    setNote("");
  }, [open]);

  const value = toRupees(amount);
  const amountIssue = amountError(amount, { max: MAX_TRANSFER_RUPEES });
  const canSend = target !== null && amountIssue === null && !sending;

  const lookup = async () => {
    const text = identifier.trim();
    if (!text) {
      setLookupIssue("Enter a mobile number or UPI ID");
      return;
    }
    setLooking(true);
    setLookupIssue(null);
    try {
      const found = await api.resolvePayee(text);
      setTarget({ user_id: found.user_id, name: found.name, vpa: found.vpa });
      feedback.success();
    } catch (err) {
      setLookupIssue(errorMessage(err));
      feedback.warn();
    } finally {
      setLooking(false);
    }
  };

  const send = async () => {
    if (!target) return;
    setSending(true);
    try {
      const created = await api.createRequest(
        { payerId: target.user_id },
        value,
        note.trim() || null,
      );
      feedback.success();
      toast.success(created.message);
      onCreated(created);
      onClose();
    } catch (err) {
      const message = errorMessage(err);
      toast.error(message);
      feedback.warn();
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask for money"
      description="They'll see it in their requests and can pay it with their PIN."
      footer={
        <Button size="lg" fullWidth loading={sending} disabled={!canSend} onClick={() => void send()}>
          {target === null
            ? "Pick someone first"
            : amountIssue !== null
              ? "Enter an amount"
              : `Ask for ${formatCurrency(value)}`}
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
            People you pay
          </p>
          <PeopleStrip
            people={people}
            status={status}
            onRetry={reload}
            onSelect={(person) => {
              setTarget({ user_id: person.user_id, name: person.name, vpa: person.vpa });
              setIdentifier("");
              setLookupIssue(null);
            }}
          />
        </div>

        {target ? (
          <div className="flex items-center gap-3 rounded-2xl bg-brand-50 p-3.5">
            <Avatar name={target.name} size="md" tone={avatarToneFor(target.vpa)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold text-brand-900">
                {personLabel(target)}
              </p>
              <p className="truncate font-mono text-[11.5px] text-brand-900/70">
                {target.vpa ?? "—"}
              </p>
            </div>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-brand-700">
              <IconCheck size={15} />
            </span>
          </div>
        ) : (
          <Field
            label="Or a mobile number / UPI ID"
            error={lookupIssue}
            hint="Try 9000000004, or 9000000002@demoupi"
          >
            {({ id, describedBy }) => (
              <div className="flex gap-2">
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="tel"
                  placeholder="9000000004 or name@demoupi"
                  value={identifier}
                  invalid={Boolean(lookupIssue)}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    setLookupIssue(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void lookup();
                  }}
                />
                <Button variant="secondary" loading={looking} onClick={() => void lookup()}>
                  Check
                </Button>
              </div>
            )}
          </Field>
        )}

        <div>
          <Field label="How much?" error={amount === "" ? null : amountIssue}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                inputMode="decimal"
                placeholder="0"
                prefix="₹"
                value={amount}
                invalid={Boolean(amount && amountIssue)}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
              />
            )}
          </Field>
          <div className="mt-2 flex gap-2">
            {QUICK_AMOUNTS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                className={cx(
                  "rounded-full px-3 py-1.5 text-[12px] font-semibold transition",
                  value === preset
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                ₹{preset}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="request-note"
            className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600"
          >
            <IconNote size={14} className="text-slate-400" /> What's it for? (optional)
          </label>
          <TextArea
            id="request-note"
            rows={2}
            maxLength={140}
            placeholder="Dinner, rent, tickets…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-600">
          <IconInfo size={14} className="mt-px shrink-0 text-slate-400" />
          Asking never moves money. It stays a request they can pay or decline, and it can't
          touch your balance.
        </p>

        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-800">
          <IconWarning size={14} className="mt-px shrink-0" />
          Demo network: only numbers seeded in this app can be found.
        </p>
      </div>
    </Sheet>
  );
}
