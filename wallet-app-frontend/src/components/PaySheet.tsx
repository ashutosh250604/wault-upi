import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { cx } from "../lib/cx";
import { mobileError, vpaError } from "../lib/validation";
import { useRecentPeople } from "../hooks/useRecentPeople";
import { PeopleStrip } from "./People";
import { Button } from "./ui/Button";
import { Field, TextInput } from "./ui/Field";
import {
  IconAddMoney,
  IconAt,
  IconChevronRight,
  IconPhone,
  IconRequest,
  IconScan,
  IconWarning,
} from "./ui/Icons";
import { TILE_GLYPH, TILE_STROKE, type IconTone } from "../lib/tiles";
import { IconTile } from "./ui/IconTile";
import { Sheet } from "./ui/Sheet";

/** The glyph size every row in this sheet uses — the system's `lg` tile. */
const ICON = TILE_GLYPH.lg;

export interface PaySheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * One way to pay, as a button rather than a row of text.
 *
 * These used to be a bare flex row that only revealed itself on hover, which is
 * exactly why they read as a list of labels. Each is now its own slip: an inked
 * edge and a hard print shadow lift it off the sheet, the chevron says "this
 * goes somewhere", and the pressed state moves the whole tile down a pixel the
 * way every other control in the app does.
 *
 * Every row carries the same edge and the same shadow. An earlier pass gave the
 * scanner a darker edge to rank it first, which just made the other four look
 * switched off — the icon tile is where a row is allowed to differ.
 *
 * The five glyphs are drawn as one set: 24-unit grid, 1.75 stroke, round caps
 * and joins, no fills, and each one an object rather than an abstraction. The
 * reticle used to have a line struck through it, "UPI ID" was a person, "add
 * money" was the same plus the nav's Pay bubble uses, and "ask for money"
 * pointed away from the person doing the asking. Each of those is now the thing
 * the row actually does.
 */
function OptionRow({
  icon,
  title,
  description,
  tone,
  solid = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** The tile's tone. One vocabulary, shared with every other list. */
  tone: IconTone;
  /** Filled tile, for the row that opens the flow rather than listing it. */
  solid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3.5 rounded-[12px] border-[1.5px] border-ink-900 bg-paper-25 p-3 text-left transition",
        "shadow-[2px_2px_0_0_rgba(25,25,22,0.75)] hover:bg-paper-100 hover:border-ink-800 active:translate-y-px active:bg-paper-200 active:shadow-none",
        "focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none",
      )}
    >
      <IconTile tone={tone} scale="lg" solid={solid}>
        {icon}
      </IconTile>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] leading-snug font-bold text-ink-900">
          {title}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500">
          {description}
        </span>
      </span>
      <IconChevronRight size={17} className="shrink-0 text-ink-500" />
    </button>
  );
}

type EntryMode = "mobile" | "vpa" | null;

/** The centre action: how real UPI apps start a payment. */
export function PaySheet({ open, onClose }: PaySheetProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<EntryMode>(null);
  const [value, setValue] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const { resolve, startPayment, busy, error, clearError } = usePayeeResolution();
  // Recents load with the sheet, so the fastest path is one tap from opening.
  const { people, status, reload } = useRecentPeople(8);

  // Reset the inline form each time the sheet is reopened.
  useEffect(() => {
    if (!open) {
      setMode(null);
      setValue("");
      setIssue(null);
      clearError();
    }
  }, [open, clearError]);

  const go = (path: string, state?: unknown) => {
    onClose();
    navigate(path, state ? { state } : undefined);
  };

  const openEntry = (next: Exclude<EntryMode, null>) => {
    setMode((current) => (current === next ? null : next));
    setValue("");
    setIssue(null);
    clearError();
  };

  const submit = async () => {
    const problem = mode === "mobile" ? mobileError(value) : vpaError(value);
    setIssue(problem);
    if (problem) return;
    const ok = await resolve(value);
    if (ok) onClose();
  };

  const isMobile = mode === "mobile";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pay someone"
      description="Pick a recent contact, scan a code, or enter a number or UPI ID."
    >
      {people && people.length > 0 ? (
        <div className="mb-4">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-500">Recents</p>
          <PeopleStrip
            people={people}
            status={status}
            showCaption
            onSelect={(person) => {
              onClose();
              startPayment(person);
            }}
            onRetry={reload}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <OptionRow
          icon={<IconScan size={ICON} strokeWidth={TILE_STROKE} />}
          title="Scan any QR code"
          description="Point your camera at a WAULT code"
          tone="ink"
          solid
          onClick={() => go("/scan")}
        />
        <OptionRow
          icon={<IconPhone size={ICON} strokeWidth={TILE_STROKE} />}
          title="Pay to mobile number"
          description="Any registered 10-digit mobile number"
          tone="ink"
          onClick={() => openEntry("mobile")}
        />
        <OptionRow
          icon={<IconAt size={ICON} strokeWidth={TILE_STROKE} />}
          title="Pay to UPI ID"
          description="A handle like 9000000002@okwault"
          tone="ink"
          onClick={() => openEntry("vpa")}
        />
        <OptionRow
          icon={<IconAddMoney size={ICON} strokeWidth={TILE_STROKE} />}
          title="Add money"
          description="Top up your own balance"
          tone="ink"
          onClick={() => go("/pay/amount", { mode: "topup" })}
        />
        <OptionRow
          icon={<IconRequest size={ICON} strokeWidth={TILE_STROKE} />}
          title="Ask for money"
          description="Send a request they can approve"
          tone="seal"
          onClick={() => go("/requests", { compose: true })}
        />
      </div>

      {mode ? (
        <div className="mt-3 animate-enter space-y-3 rounded-[10px] border-[1.5px] border-ink-900/60 bg-paper-100 p-3.5">
          <Field
            label={isMobile ? "Mobile number" : "UPI ID"}
            error={issue ?? error}
            hint={isMobile ? "Try 9000000004" : "Try 9000000002@okwault"}
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                data-autofocus
                inputMode={isMobile ? "tel" : "text"}
                placeholder={isMobile ? "10-digit mobile number" : "name@okwault"}
                value={value}
                invalid={Boolean(issue ?? error)}
                onChange={(event) => {
                  setValue(event.target.value);
                  setIssue(null);
                  clearError();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
            )}
          </Field>
          <Button fullWidth loading={busy} onClick={() => void submit()}>
            Continue
          </Button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => go("/contacts")}
        className="mt-3 w-full rounded-[10px] border border-dashed border-ink-300 py-3 text-[12.5px] font-semibold text-ink-500 transition hover:border-ink-400 hover:text-ink-700"
      >
        Manage contacts
      </button>

      <p className="mt-4 flex items-start gap-2 rounded-[10px] bg-seal-50 p-3 text-[11.5px] leading-relaxed text-seal-900 ring-1 ring-seal-100 ring-inset">
        <IconWarning size={14} className="mt-px shrink-0 text-seal-600" />
        Check the name before you approve — a transfer can't be reversed.
      </p>
    </Sheet>
  );
}
