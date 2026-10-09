import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Scanner } from "@yudiel/react-qr-scanner";
import type { IScannerError, IScannerHandle } from "@yudiel/react-qr-scanner";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { decodeQrFromImage, isImageFile } from "../lib/qr";
import { parsePaymentCode } from "../lib/upi";
import { payeeIdentifierError } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Field, TextInput } from "../components/ui/Field";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import {
  IconArrowLeft,
  IconAt,
  IconChevronRight,
  IconQr,
  IconTorch,
  IconWarning,
} from "../components/ui/Icons";
import { Sheet } from "../components/ui/Sheet";
import { Spinner } from "../components/ui/Spinner";

function cameraErrorMessage(error: IScannerError): string {
  switch (error.kind) {
    case "permission-denied":
      return "Camera access is blocked. Allow it in your browser's site settings, then try again — or upload a QR image";
    case "no-camera":
      return "No camera on this device. Upload a QR image or type the UPI ID instead.";
    case "in-use":
      return "Another app is already using the camera. Close it and try again.";
    case "insecure-context":
      return "Scanning needs HTTPS (or localhost). Upload a QR image or type the UPI ID instead.";
    case "overconstrained":
      return "The rear camera isn't available here. Try again, or type the UPI ID instead.";
    default:
      return "The camera couldn't start. Upload a QR image or type the UPI ID instead.";
  }
}

export default function ScanQrPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const scannerRef = useRef<IScannerHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scannerKey, setScannerKey] = useState(0);
  const [cameraError, setCameraError] = useState<IScannerError | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [manualOpen, setManualOpen] = useState(params.get("manual") === "1");
  const [manualVpa, setManualVpa] = useState("");
  const [manualIssue, setManualIssue] = useState<string | null>(null);

  const secureContext = typeof window === "undefined" || window.isSecureContext;
  const unsupported =
    typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia;
  const showCamera = secureContext && !unsupported && !cameraError;

  // Torch support can only be read once the stream is live.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const track = scannerRef.current?.getStream()?.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      setTorchAvailable(Boolean(capabilities?.torch));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [scannerKey]);

  const toggleTorch = async () => {
    const track = scannerRef.current?.getStream()?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as unknown as MediaTrackConstraintSet],
      });
      setTorchOn((value) => !value);
    } catch {
      setTorchAvailable(false);
      toast.error("This camera doesn't support a torch");
    }
  };

  /**
   * Shared by the camera, the gallery upload and the manual field.
   * Returns null on success, or the error message so inline forms can show it.
   */
  const pay = useCallback(
    async (
      identifier: string,
      amount?: number,
      note?: string,
      source?: string,
    ): Promise<string | null> => {
      setResolving(true);
      setErrorStatus(false);
      setStatus(
        source === "gallery" ? "Reading that QR code…" : `Looking up ${identifier}…`,
      );
      try {
        const resolved = await api.resolvePayee(identifier);
        feedback.success();
        navigate("/pay/amount", {
          state: {
            mode: "transfer",
            receiverId: resolved.user_id,
            receiverName: resolved.name,
            receiverVpa: resolved.vpa,
            suggestedAmount: amount,
            note,
          },
        });
        return null;
      } catch (err) {
        const message = errorMessage(err);
        setErrorStatus(true);
        setStatus(message);
        feedback.warn();
        toast.error(message);
        // Let the reader catch up, then resume scanning.
        window.setTimeout(() => {
          setPaused(false);
          setStatus(null);
        }, 1800);
        return message;
      } finally {
        setResolving(false);
      }
    },
    [navigate, toast],
  );

  const handleScan = useCallback(
    (codes: { rawValue: string }[]) => {
      if (resolving || paused) return;
      const raw = codes[0]?.rawValue;
      if (!raw) return;

      const parsed = parsePaymentCode(raw);
      if (!parsed) {
        setPaused(true);
        setErrorStatus(true);
        setStatus("That QR code isn't a payment code.");
        feedback.warn();
        window.setTimeout(() => {
          setPaused(false);
          setStatus(null);
        }, 2000);
        return;
      }

      setPaused(true);
      void pay(parsed.vpa, parsed.amount, parsed.note);
    },
    [paused, pay, resolving],
  );

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isImageFile(file)) {
      toast.error("Pick an image file under 10 MB");
      return;
    }
    setGalleryBusy(true);
    setStatus("Looking for a QR code in that image…");
    try {
      const raw = await decodeQrFromImage(file);
      if (!raw) {
        setErrorStatus(true);
        setStatus("No QR code found in that image. Try a clearer screenshot.");
        feedback.warn();
        return;
      }
      const parsed = parsePaymentCode(raw);
      if (!parsed) {
        setErrorStatus(true);
        setStatus("That image contains a QR code, but not a payment one.");
        feedback.warn();
        return;
      }
      setErrorStatus(false);
      await pay(parsed.vpa, parsed.amount, parsed.note, "gallery");
    } finally {
      setGalleryBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      window.setTimeout(() => setStatus(null), 1500);
    }
  };

  const submitManual = async () => {
    const issue = payeeIdentifierError(manualVpa);
    setManualIssue(issue);
    if (issue) return;
    const failure = await pay(manualVpa.trim());
    if (failure) {
      // Keep the sheet open so the user can correct the ID.
      setManualIssue(failure);
      return;
    }
    setManualOpen(false);
  };

  // One sentence for why the camera can't run — said where the camera would
  // have been, rather than as a status line under the buttons.
  const cameraReason = !secureContext
    ? "Scanning needs a secure connection — HTTPS or localhost. Upload a photo of the code, or type the number instead."
    : unsupported
      ? "This browser has no camera API. Upload a photo of the code, or type the number instead."
      : cameraError
        ? cameraErrorMessage(cameraError)
        : "The camera didn't start. Upload a photo of the code, or type the number instead.";

  return (
    <AppShell bare contentClassName="overflow-hidden">
      <div className="relative flex h-full flex-col bg-ink-950">
        {/* Camera fills the surface; the chrome floats above it. */}
        <div className="absolute inset-0">
          {showCamera ? (
            <Scanner
              key={scannerKey}
              ref={scannerRef}
              onScan={handleScan}
              onError={setCameraError}
              paused={paused || resolving}
              formats={["qr_code"]}
              components={{ finder: false, torch: false, onOff: false, zoom: false }}
              styles={{
                container: { width: "100%", height: "100%" },
                video: { width: "100%", height: "100%", objectFit: "cover" },
              }}
            />
          ) : (
            /* The fallback is a screen of its own, not a paragraph: a heading,
               a reason, and the one thing to do next. */
            <div className="flex h-full flex-col items-center justify-center gap-3.5 px-7 text-center">
              <IconTile tone="seal" scale="lg" solid>
                <IconWarning size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />
              </IconTile>
              <p className="font-display text-[16px] font-bold tracking-tight text-ink-25">
                The camera didn&apos;t start
              </p>
              <p className="max-w-[19rem] text-[13px] leading-relaxed text-ink-300">
                {cameraReason}
              </p>
              {cameraError ? (
                <Button
                  variant="onDark"
                  size="sm"
                  onClick={() => {
                    setCameraError(null);
                    setScannerKey((key) => key + 1);
                  }}
                >
                  Try the camera again
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {/* Framing hole: one huge shadow dims everything outside the square. */}
        {showCamera ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 pb-24">
            {/* aspect-square + a width, so the cutout stays square on any screen
                (a percentage height would stretch it into a rectangle). */}
            <div className="relative aspect-square w-[68%] max-w-[19rem] rounded-[20px] shadow-[0_0_0_9999px_rgba(15,15,13,0.7)]">
              {/* A hairline all the way round, with the four corners inked over
                  it: the brackets say where to aim, the rule says the code has
                  to fit inside them. */}
              <span className="absolute inset-0 rounded-[20px] ring-1 ring-ink-25/20" />
              <span className="absolute -top-px -left-px size-8 rounded-tl-[20px] border-t-[3px] border-l-[3px] border-ink-25" />
              <span className="absolute -top-px -right-px size-8 rounded-tr-[20px] border-t-[3px] border-r-[3px] border-ink-25" />
              <span className="absolute -bottom-px -left-px size-8 rounded-bl-[20px] border-b-[3px] border-l-[3px] border-ink-25" />
              <span className="absolute -right-px -bottom-px size-8 rounded-br-[20px] border-r-[3px] border-b-[3px] border-ink-25" />
              {/* The scan beam: a crisp seal hairline, no glow. */}
              <span className="absolute inset-x-2 h-2 animate-scan">
                <span className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-seal-500/30 blur-[2px]" />
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-seal-400" />
              </span>
            </div>
            {/* The instruction sits under the frame it is about, on a chip, so
                it stays legible over whatever the camera is pointing at. */}
            <p className="rounded-full bg-ink-950/65 px-3.5 py-1.5 text-[12px] font-medium text-ink-200 backdrop-blur">
              Fill the frame with the code
            </p>
          </div>
        ) : null}

        {/* Floating chrome, with a hierarchy: a titled head that says what this
            screen is and what it accepts, then one control on the right. It was
            a row of three equal objects — a button, a label and another button
            — which left the title reading as a caption between two icons. */}
        <header className="relative z-10 flex items-start gap-2 px-2.5 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Close scanner"
            className="rounded-[12px] bg-ink-950/55 p-2.5 text-ink-25 backdrop-blur transition hover:bg-ink-950/80 focus-visible:ring-2 focus-visible:ring-ink-25/60 focus-visible:outline-none"
          >
            <IconArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="truncate font-display text-[17px] leading-none font-bold tracking-tight text-ink-25 drop-shadow">
              Scan &amp; pay
            </h1>
            <p className="mt-1.5 truncate text-[11.5px] leading-none text-ink-300">
              Works with any app&apos;s UPI QR code
            </p>
          </div>
          {torchAvailable ? (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
              className={
                torchOn
                  ? "rounded-[12px] bg-seal-500 p-2.5 text-ink-25 focus-visible:ring-2 focus-visible:ring-ink-25/60 focus-visible:outline-none"
                  : "rounded-[12px] bg-ink-950/55 p-2.5 text-ink-25 backdrop-blur transition hover:bg-ink-950/80 focus-visible:ring-2 focus-visible:ring-ink-25/60 focus-visible:outline-none"
              }
            >
              <IconTorch size={19} />
            </button>
          ) : null}
        </header>

        <div className="relative z-10 flex-1" />

        {/* Controls.

            Three tiers instead of two buttons of equal weight. The status line
            is a live indicator while the camera is open (it used to sit as
            static grey text saying what the header now says), the photo upload
            is the primary action, and typing a handle is a quiet row under it —
            which is the real order of preference when a camera is already
            pointing at something. */}
        <div className="relative z-10 space-y-2.5 rounded-t-[18px] border-t border-ink-800 bg-ink-950/85 px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          <div
            className="flex min-h-5 items-center justify-center gap-2 px-2 text-center"
            aria-live="polite"
          >
            {resolving || galleryBusy ? (
              <>
                <Spinner size={14} className="text-ink-300" />
                <span className="text-[12.5px] font-medium text-ink-200">
                  {status ?? "Working…"}
                </span>
              </>
            ) : status ? (
              <span
                className={
                  errorStatus
                    ? "text-[12.5px] font-medium text-seal-300"
                    : "text-[12.5px] font-medium text-ink-200"
                }
              >
                {status}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-ink-300">
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-credit-600 opacity-70" />
                  <span className="relative inline-flex size-2 rounded-full bg-credit-600" />
                </span>
                Looking for a code
              </span>
            )}
          </div>

          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leftIcon={<IconQr size={18} />}
            onClick={() => fileRef.current?.click()}
            disabled={galleryBusy || resolving}
          >
            Upload a QR photo
          </Button>

          {/* The second way in, as a row rather than a button: same action as
              before, one tier down, and with room to say when to use it. */}
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            disabled={resolving}
            className="flex w-full items-center gap-3 rounded-[12px] border-[1.5px] border-ink-800 bg-ink-900 px-4 py-2.5 text-left transition hover:border-ink-600 hover:bg-ink-800 active:bg-ink-950 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ink-25/60 focus-visible:outline-none"
          >
            <IconAt size={18} className="shrink-0 text-ink-300" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] leading-snug font-semibold text-ink-25">
                Enter a number or UPI ID
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-ink-400">
                If the code won&apos;t scan, type the handle instead
              </span>
            </span>
            <IconChevronRight size={17} className="shrink-0 text-ink-500" />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void onPickFile(event.target.files?.[0])}
        />
      </div>

      <Sheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Pay by number or UPI ID"
        description="Type the number or handle you want to pay."
      >
        <div className="space-y-4">
          <Field
            label="Mobile number or UPI ID"
            error={manualIssue}
            hint="Try 9000000004, or 9000000002@okwault"
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                autoFocus
                placeholder="9000000004 or name@okwault"
                value={manualVpa}
                invalid={Boolean(manualIssue)}
                onChange={(event) => {
                  setManualVpa(event.target.value);
                  setManualIssue(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitManual();
                }}
              />
            )}
          </Field>
          <Button fullWidth size="lg" loading={resolving} onClick={() => void submitManual()}>
            Continue
          </Button>
        </div>
      </Sheet>
    </AppShell>
  );
}
