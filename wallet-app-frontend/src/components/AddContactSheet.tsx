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
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "./ui/IconTile";
import { IconCheck, IconInfo, IconPhone, IconStar } from "./ui/Icons";
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
        hint="Try 9000000004, or 9000000002@okwault"
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            data-autofocus
            inputMode="tel"
            placeholder="9000000004 or name@okwault"
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
          <div className="flex items-center gap-3 rounded-[10px] bg-paper-100 p-3.5 ring-1 ring-ink-200/70 ring-inset">
            <Avatar
              name={preview.name}
              size="lg"
              tone={avatarToneFor(preview.vpa ?? preview.mobile ?? preview.name)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15.5px] font-bold tracking-tight text-ink-900">
                {preview.name ?? "WAULT user"}
              </p>
              <p className="truncate font-mono text-[11.5px] text-ink-500">
                {personHandle(preview)}
              </p>
            </div>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-credit-50 text-credit-700">
              <IconCheck size={15} />
            </span>
          </div>

          {preview.is_saved ? (
            <p className="flex items-start gap-2 rounded-[10px] bg-paper-100 p-3 text-[12px] leading-relaxed text-ink-600 ring-1 ring-ink-200/70 ring-inset">
              <IconInfo size={14} className="mt-px shrink-0 text-ink-400" />
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
                className="flex w-full items-center gap-3 rounded-[10px] border-[1.5px] border-ink-900/60 p-3.5 text-left transition hover:bg-paper-100"
              >
                <IconTile tone="seal" scale="sm">
                  <IconStar size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} filled={favourite} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink-900">
                    Add to favourites
                  </span>
                  <span className="block text-[12px] text-ink-500">
                    Favourites appear first in your contact list
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    favourite ? "bg-ink-900" : "bg-ink-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-paper-25 shadow transition-all ${
                      favourite ? "left-[1.375rem]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-[10px] bg-paper-100 p-3 text-[12px] leading-relaxed text-ink-600 ring-1 ring-ink-200/70 ring-inset">
          <IconPhone size={14} className="mt-px shrink-0 text-ink-400" />
          Look anyone up by the mobile number they registered, or by their UPI ID. Their
          registered name is what you will see when you pay.
        </p>
      )}

      <p className="mt-4 flex items-start gap-2 rounded-[10px] bg-paper-100 p-3 text-[11.5px] leading-relaxed text-ink-600 ring-1 ring-ink-200/70 ring-inset">
        <IconInfo size={14} className="mt-px shrink-0 text-ink-400" />
        Only mobile numbers and UPI IDs already registered with WAULT can be found.
      </p>
    </Sheet>
  );
}
