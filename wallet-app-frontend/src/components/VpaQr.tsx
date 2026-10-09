import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { BRAND_ASSETS, MARK_ASPECT, SHEET, markHeight } from "../lib/brand";
import { buildPaymentPayload } from "../lib/upi";
import { shareText } from "../lib/clipboard";
import { useToast } from "../hooks/toast";
import { useCopy } from "../hooks/useCopy";
import { BrandMark } from "./AppShell";
import { Button } from "./ui/Button";
import { IconCheck, IconCopy, IconDownload, IconQr, IconShare } from "./ui/Icons";

export interface VpaQrProps {
  vpa: string;
  name: string | null;
}

/**
 * The mark, stamped into the middle of the code.
 *
 * The code renders at error-correction level H (30% of the modules can be lost
 * and it still decodes) and the cleared plate covers a little over 6% of its
 * area, so there is a wide margin of safety. The plate is as wide as the mark
 * is: a square plate around a landscape logo left two bands of dead paper. It is
 * painted onto the canvas rather than layered in DOM, which is what keeps the
 * downloaded PNG branded too.
 *
 * The mark itself is `public/brand/wault-mark.png` — the supplied artwork, on
 * the same cream plate so the modules underneath keep the quiet zone a scanner
 * expects. It used to be redrawn here from `lib/brand.ts`'s geometry, which is
 * exactly why the code in the middle of this screen looked like a lookalike of
 * the logo rather than the logo.
 */
function drawCentreMark(canvas: HTMLCanvasElement, mark: HTMLImageElement | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // qrcode.react paints through a transform of its own (one canvas unit is one
  // module), and it leaves that transform in place. The mark is measured in
  // device pixels, so the transform is reset before drawing — otherwise the
  // plate lands several screens away from the code.
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const side = canvas.width;
  const centre = side / 2;
  const plateW = side * 0.3;
  const plateH = plateW / MARK_ASPECT;

  ctx.fillStyle = QR_PAPER;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(
      centre - plateW / 2,
      centre - plateH / 2,
      plateW,
      plateH,
      plateH * 0.26,
    );
  } else {
    ctx.rect(centre - plateW / 2, centre - plateH / 2, plateW, plateH);
  }
  ctx.closePath();
  ctx.fill();

  if (!mark) return;
  const width = plateW * 0.9;
  ctx.drawImage(
    mark,
    centre - width / 2,
    centre - markHeight(width) / 2,
    width,
    markHeight(width),
  );
}

/** The code is printed on the app's brightest sheet, never on white. */
const QR_PAPER = SHEET;

/**
 * A payment slip you can hold up to be scanned: the issuing mark on the ink
 * head, the code pressed into warm paper with the scanner's reticle drawn
 * around it, and the share actions below a perforation.
 */
export function VpaQr({ vpa, name }: VpaQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLImageElement | null>(null);
  const [markReady, setMarkReady] = useState(false);
  const toast = useToast();
  const { copied, copy } = useCopy();

  // The mark is a file, so it arrives a frame or two after the code does. The
  // redraw is keyed off this flag rather than off a timer.
  useEffect(() => {
    const image = new Image();
    image.src = BRAND_ASSETS.mark;
    image.onload = () => {
      markRef.current = image;
      setMarkReady(true);
    };
    return () => {
      image.onload = null;
    };
  }, []);

  // Stamped twice: once on mount, and again when the artwork arrives. It is
  // keyed off `markReady` because the code itself is drawn from constant props,
  // so qrcode.react paints it once and never repaints over the mark.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawCentreMark(canvas, markRef.current);
  }, [markReady]);

  const onDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      toast.error("Couldn't generate the QR image");
      return;
    }
    try {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `okwault-${vpa.split("@")[0]}.png`;
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
      title: "My WAULT UPI ID",
      text: `Pay me on WAULT: ${vpa}`,
    });
    if (result === "copied") toast.success("UPI ID copied to clipboard");
    if (result === "failed") toast.error("Couldn't share your UPI ID");
  };

  return (
    <div className="overflow-hidden rounded-[16px] border-[1.5px] border-ink-900 bg-paper-25 shadow-[4px_4px_0_0_rgba(25,25,22,0.85)]">
      {/* Head of the slip: who this code pays. */}
      <div className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-3 text-ink-25">
        <BrandMark invert />
        <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-semibold text-ink-300 ring-1 ring-ink-700">
          Scan to pay
        </span>
      </div>

      <div className="flex flex-col items-center px-4 pt-5">
        {/* The code pressed into a warm well, with the scanner's reticle drawn
            around it — the same four ticks the camera screen uses. */}
        <div className="rounded-[18px] bg-paper-100 p-4">
          <div className="relative">
            <QRCodeCanvas
              ref={canvasRef}
              value={buildPaymentPayload(vpa, name)}
              size={512}
              // H tolerates the seal in the middle; M would leave too little room.
              level="H"
              marginSize={2}
              bgColor={QR_PAPER}
              fgColor="#0f0f0d"
              style={{ width: 208, height: 208, display: "block" }}
              aria-label={`UPI QR code for ${vpa}`}
            />
            <span className="pointer-events-none absolute -top-1.5 -left-1.5 size-5 border-t-2 border-l-2 border-seal-500" />
            <span className="pointer-events-none absolute -top-1.5 -right-1.5 size-5 border-t-2 border-r-2 border-seal-500" />
            <span className="pointer-events-none absolute -bottom-1.5 -left-1.5 size-5 border-b-2 border-l-2 border-seal-500" />
            <span className="pointer-events-none absolute -right-1.5 -bottom-1.5 size-5 border-r-2 border-b-2 border-seal-500" />
          </div>
        </div>

        <p className="mt-4 font-display text-[18px] font-bold tracking-tight text-ink-900">
          {name ?? "WAULT user"}
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-ink-900/70 bg-paper-100 px-3 py-1 font-mono text-[12.5px] text-ink-800 tabular-nums">
          <IconQr size={13} className="text-ink-500" />
          {vpa}
        </span>

        {/* The slip's own detail block: what a payer would fill in by hand. */}
        <dl className="mt-4 w-full space-y-1.5 text-[11.5px]">
          <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-ink-300 pt-2.5">
            <dt className="text-ink-500">Pays to</dt>
            <dd className="font-mono font-semibold text-ink-800 tabular-nums">{vpa}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-500">Amount</dt>
            <dd className="font-semibold text-ink-800">The payer chooses</dd>
          </div>
        </dl>
      </div>

      {/* Perforation: the actions tear off the bottom of the slip. The two holes
          are inked like the receipt's, so a torn edge is the same mark wherever
          this app draws one. */}
      <div className="relative mt-5 border-t border-dashed border-ink-300 px-4 pt-4 pb-4">
        <span
          aria-hidden="true"
          className="absolute -top-[7px] left-4 size-3.5 rounded-full border-[1.5px] border-ink-900 bg-ink-900"
        />
        <span
          aria-hidden="true"
          className="absolute -top-[7px] right-4 size-3.5 rounded-full border-[1.5px] border-ink-900 bg-ink-900"
        />
        <div className="grid w-full grid-cols-3 gap-2">
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
    </div>
  );
}
