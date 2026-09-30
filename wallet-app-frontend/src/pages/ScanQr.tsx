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
import { IconArrowLeft, IconTorch, IconWarning } from "../components/ui/Icons";
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

  return (
    <AppShell bare contentClassName="overflow-hidden">
      <div className="relative flex h-full flex-col bg-slate-950">
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
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-amber-300">
                <IconWarning size={22} />
              </span>
              <p className="text-[13.5px] leading-relaxed text-white/90">
                {!secureContext
                  ? "Camera scanning needs HTTPS. Upload a QR image or type the UPI ID instead."
                  : unsupported
                    ? "This browser has no camera API. Upload a QR image or type the UPI ID instead."
                    : cameraError
                      ? cameraErrorMessage(cameraError)
                      : "Camera unavailable."}
              </p>
              {cameraError ? (
                <Button
                  variant="secondary"
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* aspect-square + a width, so the cutout stays square on any screen
                (a percentage height would stretch it into a rectangle). */}
            <div className="relative aspect-square w-[68%] max-w-[19rem] rounded-3xl shadow-[0_0_0_9999px_rgba(2,6,23,0.62)]">
              <span className="absolute -top-px -left-px size-8 rounded-tl-3xl border-t-4 border-l-4 border-white" />
              <span className="absolute -top-px -right-px size-8 rounded-tr-3xl border-t-4 border-r-4 border-white" />
              <span className="absolute -bottom-px -left-px size-8 rounded-bl-3xl border-b-4 border-l-4 border-white" />
              <span className="absolute -right-px -bottom-px size-8 rounded-br-3xl border-r-4 border-b-4 border-white" />
              <span className="absolute inset-x-3 h-0.5 animate-scan rounded-full bg-gradient-to-r from-transparent via-brand-300 to-transparent shadow-[0_0_12px_2px_rgba(112,72,251,0.65)]" />
            </div>
          </div>
        ) : null}

        {/* Floating chrome */}
        <div className="relative z-10 flex items-center gap-1 px-2 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Close scanner"
            className="rounded-full bg-slate-950/45 p-2.5 text-white backdrop-blur transition hover:bg-slate-950/70"
          >
            <IconArrowLeft size={20} />
          </button>
          <p className="flex-1 pl-1 text-[15px] font-semibold text-white drop-shadow">
            Scan any QR
          </p>
          {torchAvailable ? (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
              className={
                torchOn
                  ? "rounded-full bg-amber-400/95 p-2.5 text-slate-900"
                  : "rounded-full bg-slate-950/45 p-2.5 text-white backdrop-blur transition hover:bg-slate-950/70"
              }
            >
              <IconTorch size={19} />
            </button>
          ) : null}
        </div>

        <div className="relative z-10 flex-1" />

        {/* Controls */}
        <div className="relative z-10 space-y-3 rounded-t-3xl bg-slate-950/75 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          <div className="flex min-h-5 items-center justify-center gap-2 px-2 text-center" aria-live="polite">
            {resolving || galleryBusy ? (
              <>
                <Spinner size={14} className="text-white/80" />
                <span className="text-[12.5px] font-medium text-white/85">
                  {status ?? "Working…"}
                </span>
              </>
            ) : status ? (
              <span
                className={
                  errorStatus
                    ? "text-[12.5px] font-medium text-rose-300"
                    : "text-[12.5px] font-medium text-white/85"
                }
              >
                {status}
              </span>
            ) : (
              <span className="text-[12.5px] text-white/70">
                Point the camera at a PocketPay QR code
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => fileRef.current?.click()}
              disabled={galleryBusy || resolving}
            >
              Upload QR
            </Button>
            <Button size="lg" onClick={() => setManualOpen(true)} disabled={resolving}>
              Enter number
            </Button>
          </div>

          <p className="text-center text-[11px] text-white/45">
            Demo only — no NPCI/UPI integration and no real money.
          </p>
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
            hint="Try 9000000004, or 9000000002@demoupi"
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                autoFocus
                placeholder="9000000004 or name@demoupi"
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
