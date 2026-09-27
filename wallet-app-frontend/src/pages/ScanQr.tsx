import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Scanner } from "@yudiel/react-qr-scanner";
import type { IScannerError, IScannerHandle } from "@yudiel/react-qr-scanner";
import { api, errorMessage } from "../lib/api";
import { vpaError } from "../lib/validation";
import { useToast } from "../hooks/toast";
import { AppBar, AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field, TextInput } from "../components/ui/Field";
import { IconTorch, IconWarning } from "../components/ui/Icons";
import { Spinner } from "../components/ui/Spinner";

interface ScannedVpa {
  vpa: string;
  amount?: number;
}

/**
 * Pull a UPI ID out of whatever the camera read: a `upi://pay?pa=…` deep link
 * (what the "My QR" screen generates) or a bare `name@bank` string.
 */
function extractVpa(raw: string): ScannedVpa | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const vpa = url.searchParams.get("pa") ?? url.searchParams.get("vpa");
      if (!vpa) return null;
      const rawAmount = url.searchParams.get("am");
      const amount = rawAmount ? Number.parseFloat(rawAmount) : Number.NaN;
      return {
        vpa: vpa.trim().toLowerCase(),
        amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
      };
    } catch {
      return null;
    }
  }

  if (/^[^\s@]+@[^\s@]+$/.test(text)) return { vpa: text.toLowerCase() };
  return null;
}

function cameraErrorMessage(error: IScannerError): string {
  switch (error.kind) {
    case "permission-denied":
      return "Camera access is blocked. Allow it in your browser's site settings, then reload — or type the UPI ID below.";
    case "no-camera":
      return "No camera found on this device. Type the UPI ID below instead.";
    case "in-use":
      return "Another app is already using the camera. Close it and try again.";
    case "insecure-context":
      return "Scanning needs HTTPS (or localhost). Type the UPI ID below instead.";
    case "overconstrained":
      return "The rear camera isn't available here. Try again, or type the UPI ID below.";
    default:
      return "The camera couldn't start. Type the UPI ID below instead.";
  }
}

export default function ScanQrPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const scannerRef = useRef<IScannerHandle>(null);
  const [scannerKey, setScannerKey] = useState(0);
  const [cameraError, setCameraError] = useState<IScannerError | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [manualVpa, setManualVpa] = useState("");
  const [manualIssue, setManualIssue] = useState<string | null>(null);

  const secureContext = typeof window === "undefined" || window.isSecureContext;
  const unsupported =
    typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia;

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

  const goToPayment = useCallback(
    (resolved: { user_id: number; name: string | null; vpa: string }, amount?: number) => {
      navigate("/pay/amount", {
        state: {
          mode: "transfer",
          receiverId: resolved.user_id,
          receiverName: resolved.name,
          receiverVpa: resolved.vpa,
          suggestedAmount: amount,
        },
      });
    },
    [navigate],
  );

  const resolve = useCallback(
    async (vpa: string, amount?: number) => {
      setResolving(true);
      setScanError(null);
      try {
        const resolved = await api.resolveVpa(vpa);
        goToPayment(resolved, amount);
      } catch (err) {
        const message = errorMessage(err);
        setScanError(message);
        toast.error(message);
        // Give the user a moment to read it, then resume scanning.
        window.setTimeout(() => setPaused(false), 1600);
      } finally {
        setResolving(false);
      }
    },
    [goToPayment, toast],
  );

  const handleScan = useCallback(
    (codes: { rawValue: string }[]) => {
      if (resolving || paused) return;
      const raw = codes[0]?.rawValue;
      if (!raw) return;

      const parsed = extractVpa(raw);
      if (!parsed) {
        setPaused(true);
        setScanError("That QR code isn't a PocketPay payment code.");
        window.setTimeout(() => setPaused(false), 2000);
        return;
      }

      setPaused(true);
      void resolve(parsed.vpa, parsed.amount);
    },
    [paused, resolving, resolve],
  );

  const submitManual = () => {
    const issue = vpaError(manualVpa);
    setManualIssue(issue);
    if (issue) return;
    void resolve(manualVpa.trim().toLowerCase());
  };

  const showCamera = secureContext && !unsupported && !cameraError;

  return (
    <AppShell
      nav
      header={
        <AppBar
          title="Scan & pay"
          right={
            torchAvailable ? (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
                className={
                  torchOn
                    ? "rounded-full bg-amber-100 p-2 text-amber-700"
                    : "rounded-full p-2 text-slate-500 transition hover:bg-slate-100"
                }
              >
                <IconTorch size={18} />
              </button>
            ) : undefined
          }
        />
      }
    >
      <div className="space-y-5 px-5 pt-4 pb-6">
        <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-slate-900">
          {showCamera ? (
            <>
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

              {/* Framing overlay */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-slate-900/25" />
                <div className="absolute top-1/2 left-1/2 size-[64%] -translate-x-1/2 -translate-y-1/2">
                  <span className="absolute inset-0 rounded-2xl border-2 border-white/25" />
                  <span className="absolute -top-px -left-px size-7 rounded-tl-2xl border-t-4 border-l-4 border-white" />
                  <span className="absolute -top-px -right-px size-7 rounded-tr-2xl border-t-4 border-r-4 border-white" />
                  <span className="absolute -bottom-px -left-px size-7 rounded-bl-2xl border-b-4 border-l-4 border-white" />
                  <span className="absolute -right-px -bottom-px size-7 rounded-br-2xl border-r-4 border-b-4 border-white" />
                  <span className="absolute inset-x-2 h-0.5 animate-scan rounded-full bg-gradient-to-r from-transparent via-brand-300 to-transparent shadow-[0_0_12px_2px_rgba(112,72,251,0.6)]" />
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-amber-300">
                <IconWarning size={22} />
              </span>
              <p className="text-[13.5px] leading-relaxed text-white/90">
                {!secureContext
                  ? "Camera scanning requires HTTPS. Use the UPI ID field below, or open the deployed https:// URL."
                  : unsupported
                    ? "This browser has no camera API. Use the UPI ID field below."
                    : cameraError
                      ? cameraErrorMessage(cameraError)
                      : "Camera unavailable. Use the UPI ID field below."}
              </p>
              {cameraError ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
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

          {resolving ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70 text-white">
              <Spinner size={22} />
              <p className="text-[13px] font-medium">Looking up the recipient…</p>
            </div>
          ) : null}
        </div>

        <div className="min-h-5 text-center" aria-live="polite">
          {scanError ? (
            <p className="text-[13px] font-medium text-rose-600">{scanError}</p>
          ) : (
            <p className="text-[13px] text-slate-500">
              Point the camera at a PocketPay QR code
            </p>
          )}
        </div>

        <Card className="space-y-4">
          <div>
            <h2 className="text-[14.5px] font-bold text-slate-900">Or pay by UPI ID</h2>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              Type the UPI ID you want to pay — no camera needed.
            </p>
          </div>

          <Field label="UPI ID" error={manualIssue} hint="Example: 9000000002@demoupi">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                placeholder="name@demoupi"
                autoComplete="off"
                value={manualVpa}
                invalid={Boolean(manualIssue)}
                onChange={(event) => {
                  setManualVpa(event.target.value);
                  setManualIssue(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitManual();
                }}
              />
            )}
          </Field>

          <Button
            fullWidth
            size="lg"
            loading={resolving}
            disabled={!manualVpa.trim()}
            onClick={submitManual}
          >
            Find recipient
          </Button>

          <p className="text-center text-[12px] text-slate-500">
            Try <span className="font-mono font-semibold">9000000002@demoupi</span> — the
            seeded second account.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
