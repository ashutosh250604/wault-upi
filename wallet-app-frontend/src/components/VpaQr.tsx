import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { shareText } from "../lib/clipboard";
import { useToast } from "../hooks/toast";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/Button";
import { IconCheck, IconCopy, IconDownload, IconShare } from "./ui/Icons";

/**
 * The scannable payload. Mirrors the standard `upi://pay` deep link format, so
 * any UPI scanner can parse it and the in-app scanner round-trips it too.
 */
function paymentPayload(vpa: string, name: string | null): string {
  const params = new URLSearchParams({ pa: vpa, pn: name ?? "Wallet Pay user", cu: "INR" });
  // URLSearchParams encodes spaces as "+", which some scanners mis-read.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

export interface VpaQrProps {
  vpa: string;
  name: string | null;
}

export function VpaQr({ vpa, name }: VpaQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toast = useToast();
  const { copied, copy } = useCopy();

  const onDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      toast.error("Couldn't generate the QR image");
      return;
    }
    try {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `walletpay-${vpa.split("@")[0]}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("QR code downloaded");
    } catch {
      toast.error("Couldn't save the QR image");
    }
  };

  const onShare = async () => {
    const result = await shareText({
      title: "My Wallet Pay UPI ID",
      text: `Pay me on Wallet Pay: ${vpa}`,
    });
    if (result === "copied") toast.success("UPI ID copied to clipboard");
    if (result === "failed") toast.error("Couldn't share your UPI ID");
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <QRCodeCanvas
          ref={canvasRef}
          value={paymentPayload(vpa, name)}
          size={512}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#20104f"
          style={{ width: 208, height: 208, display: "block" }}
          aria-label={`UPI QR code for ${vpa}`}
        />
        {/* Corner brackets echo the app's scanner frame. */}
        <span className="pointer-events-none absolute inset-1 rounded-2xl ring-2 ring-brand-500/15" />
      </div>

      <p className="mt-4 text-[17px] font-bold text-slate-900">{name ?? "Wallet Pay user"}</p>
      <p className="mt-0.5 text-[13.5px] text-slate-500 tabular-nums">{vpa}</p>

      <div className="mt-5 grid w-full grid-cols-3 gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void copy(vpa)}
          leftIcon={copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownload}
          leftIcon={<IconDownload size={15} />}
        >
          Save
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onShare()}
          leftIcon={<IconShare size={15} />}
        >
          Share
        </Button>
      </div>
    </div>
  );
}
