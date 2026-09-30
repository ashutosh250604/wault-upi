import { useEffect, useState } from "react";
import type { Contact, PayeePreview } from "../types";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { avatarToneFor } from "../lib/avatar";
import { personHandle } from "../lib/people";
import { payeeIdentifierError } from "../lib/validation";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { useToast } from "../hooks/toast";
import { Avatar } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { Field, TextInput } from "./ui/Field";
import { IconCheck, IconInfo, IconPhone, IconWarning } from "./ui/Icons";
import { Sheet } from "./ui/Sheet";

export interface AddContactSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the saved contact so the caller can update its list in place. */
  onSaved?: (contact: Contact) => void;
}

/**
 * "Who do you want to pay?" as a directory lookup: type a mobile number or UPI
 * ID, we resolve it to the registered name, and only then offer to save it.
 * Nothing is stored until the directory has confirmed who it is.
 */
export function AddContactSheet({ open, onClose, onSaved }: AddContactSheetProps) {
  const toast = useToast();
  const { startPayment } = usePayeeResolution();

  const [identifier, setIdentifier] = useState("");
  const [nickname, setNickname] = useState("");
  const [favourite, setFavourite] = useState(false);
  const [preview, setPreview] = useState<PayeePreview | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) return;
    setIdentifier("");
    setNickname("");
    setFavourite(false);
    setPreview(null);
    setIssue(null);
  }, [open]);

  const lookup = async () => {
    const problem = payeeIdentifierError(identifier);
    setIssue(problem);
    if (problem) return;

    setBusy(true);
    setIssue(null);
    try {
      const found = await api.resolvePayee(identifier.trim());
      setPreview(found);
      feedback.success();
    } catch (err) {
      setIssue(errorMessage(err));
      feedback.warn();
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const contact = await api.addContact(identifier.trim(), {
        nickname: nickname.trim() || undefined,
        favourite,
      });
      feedback.success();
      toast.success(contact.message);
      onSaved?.(contact);
      onClose();
    } catch (err) {
      const message = errorMessage(err);
      setIssue(message);
      toast.error(message);
      feedback.warn();
    } finally {
      setSaving(false);
    }
  };

  const payInstead = () => {
    if (!preview) return;
    onClose();
    startPayment(preview);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a contact"
      description="We'll look them up in the network before saving, so the name is theirs."
      footer={
        preview ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" fullWidth onClick={payInstead}>
              Pay instead
            </Button>
            <Button
              size="lg"
              fullWidth
              loading={saving}
              disabled={preview.is_saved}
              onClick={() => void save()}
            >
              {preview.is_saved ? "Already saved" : "Save contact"}
            </Button>
          </div>
        ) : (
          <Button size="lg" fullWidth loading={busy} onClick={() => void lookup()}>
            Check
          </Button>
        )
      }
    >
      <Field
        label="Mobile number or UPI ID"
        error={issue}
        hint="Try 9000000004, or 9000000002@demoupi"
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            data-autofocus
            inputMode="tel"
            placeholder="9000000004 or name@demoupi"
            value={identifier}
            invalid={Boolean(issue)}
            onChange={(event) => {
              setIdentifier(event.target.value);
              // Any edit invalidates the lookup it was based on.
              setPreview(null);
              setIssue(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void lookup();
            }}
          />
        )}
      </Field>

      {preview ? (
        <div className="mt-4 animate-enter space-y-3">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3.5">
            <Avatar
              name={preview.name}
              size="lg"
              tone={avatarToneFor(preview.vpa ?? preview.mobile ?? preview.name)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-slate-900">
                {preview.name ?? "PocketPay user"}
              </p>
              <p className="truncate font-mono text-[12px] text-slate-500">
                {personHandle(preview)}
              </p>
            </div>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <IconCheck size={15} />
            </span>
          </div>

          {preview.is_saved ? (
            <p className="flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-[12px] leading-relaxed text-brand-900">
              <IconInfo size={14} className="mt-px shrink-0" />
              You already have this person in your contacts.
            </p>
          ) : (
            <>
              <Field label="Nickname (optional)">
                {({ id }) => (
                  <TextInput
                    id={id}
                    placeholder="How you'll recognise them"
                    maxLength={60}
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                  />
                )}
              </Field>

              <button
                type="button"
                role="switch"
                aria-checked={favourite}
                onClick={() => setFavourite((value) => !value)}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 p-3.5 text-left transition hover:bg-slate-50"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                  ★
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-slate-900">
                    Add to favourites
                  </span>
                  <span className="block text-[12px] text-slate-500">
                    Favourites appear first in your contact list
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    favourite ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                      favourite ? "left-[1.375rem]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600">
          <IconPhone size={14} className="mt-px shrink-0 text-slate-400" />
          Look anyone up by the mobile number they registered, or by their UPI ID. Their
          registered name is what you will see when you pay.
        </p>
      )}

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-800">
        <IconWarning size={14} className="mt-px shrink-0" />
        Demo network: only numbers seeded in this app can be found.
      </p>
    </Sheet>
  );
}
