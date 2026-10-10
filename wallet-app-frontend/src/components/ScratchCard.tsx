import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { BRAND_ASSETS } from "../lib/brand";
import { cx } from "../lib/cx";
import { feedback } from "../lib/feedback";
import { Coin } from "./ui/Coin";

/**
 * The scratch card: a reward, hidden under the logo.
 *
 * The point of a scratch card is that the prize is *under* something, so the
 * cover is real silver rather than an animation — a canvas painted with the
 * app-icon artwork, which the finger erases. Scratching a single pixel of it
 * shows a single pixel of the card underneath, which is what makes scratching
 * little and often feel like getting somewhere; the cover also dissolves on its
 * own once enough of it is gone, so nobody has to rub the whole card out.
 *
 * The prize is not in the document until the cover is off. That is the whole
 * difference between a covered card and a revealed one: an unscratched card
 * that renders its number is a card whose number can be read without scratching
 * it — out of a screenshot, out of the accessibility tree, or out of a cover
 * that has not finished painting. So a covered card draws the paper face and
 * the words "keep scratching", and the coins arrive on the reveal.
 *
 * **The reveal waits for the claim.** The amount is not known until the server
 * answers the scratch — the card is what pays, and the scratch is what collects
 * — so crossing the threshold asks the caller to claim and holds the cover until
 * it hears back. A refused claim puts the cover back in play (the card can be
 * scratched again) rather than showing a number nothing agreed with; a card
 * that has already been claimed simply renders it.
 *
 * The artwork is the supplied logo, not a redrawing of it: the field behind the
 * tile is the tile's own gradient, measured off the file, and the tile is drawn
 * whole at its own aspect — `public/brand/wault-icon.png` is square and its
 * corners are already transparent, so it sits on that field with no seam.
 *
 * Reveal is deliberately cheap (`REVEAL_AT`): about an eighth of the card. A
 * scratch card that demands the whole surface is a chore, and the coins are
 * already in the balance either way — this is the telling, not the paying.
 *
 * "Reveal without scratching" is not a fallback for a broken canvas. A scratch
 * card is a pointer gesture, and a card is not allowed to have a prize that a
 * keyboard or a screen reader cannot get to.
 */

/** How much of the cover has to be gone before it lifts by itself. */
const REVEAL_AT = 0.12;
/** The finger's radius, in CSS pixels. */
const BRUSH = 24;
/** The tile's own gradient, sampled from `wault-icon.png` top to bottom. */
const COVER_TOP = "#f73124";
const COVER_MID = "#d41e17";
const COVER_BOTTOM = "#b10604";

/** The canvas at the resolution it is actually displayed at, capped at 2x. */
function coverScale(): number {
  return Math.min(2, window.devicePixelRatio || 1);
}

/**
 * Paint the untouched cover: the brand's red field with the tile stamped on it.
 *
 * The plate is measured here rather than sized from props, and measured by the
 * caller whenever its box changes, because "measure once on mount" is not good
 * enough for a canvas that lives in a sheet that slides in. A canvas nobody
 * sizes keeps the 300×150 default it was born with — and one that was painted
 * before it had a box is not merely the wrong size, it is *empty*, which looks
 * exactly like a broken feature.
 *
 * The measurement is the canvas's *layout* box (`clientWidth`), never the
 * bounding rect: the rect includes the entrance animation's transform, so a
 * cover sized from it is sized for a frame that is already gone.
 *
 * A repaint is skipped when nothing that matters has changed, because a size
 * change during play would otherwise wipe out what the finger had uncovered.
 */
function paintCover(canvas: HTMLCanvasElement, tile: HTMLImageElement | null) {
  if (canvas.clientWidth < 1 || canvas.clientHeight < 1) return;

  const scale = coverScale();
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  const painted = tile ? "tile" : "field";
  if (
    canvas.width === width &&
    canvas.height === height &&
    canvas.dataset.cover === painted
  ) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
  canvas.dataset.cover = painted;

  // The same context the coverage sampler reads: this canvas is painted once
  // and then read many times a second while a finger is on it, which is exactly
  // the case `willReadFrequently` exists for.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);

  const field = ctx.createLinearGradient(0, 0, 0, height);
  field.addColorStop(0, COVER_TOP);
  field.addColorStop(0.55, COVER_MID);
  field.addColorStop(1, COVER_BOTTOM);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, width, height);

  if (!tile) return;
  // Whole, at its own aspect, centred: the logo is never cropped or stretched.
  const side = Math.min(width, height);
  ctx.drawImage(tile, (width - side) / 2, (height - side) / 2, side, side);
}

export interface ScratchCardProps {
  /** The coins this card paid, or null while it is still under its cover. */
  coins: number | null;
  /** True once the card has been claimed — owned by the caller, which stores it. */
  revealed: boolean;
  /**
   * Claim the card, and answer whether it worked. The caller owns the request
   * and the coins that come back with it, and flips `revealed` when it succeeds;
   * a false answer leaves the cover scratchable.
   */
  onClaim: () => Promise<boolean>;
  /** Tighter proportions, for the two-column collection. */
  compact?: boolean;
  className?: string;
}

export function ScratchCard({
  coins,
  revealed,
  onClaim,
  compact = false,
  className,
}: ScratchCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileRef = useRef<HTMLImageElement | null>(null);
  const erasing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number; radius: number } | null>(null);
  const moves = useRef(0);
  const [tileReady, setTileReady] = useState(false);
  // The card stops asking to be scratched the moment it is.
  const [touched, setTouched] = useState(false);
  // True between asking for the claim and hearing back, which is when the card
  // is holding the cover for the server's answer.
  const [claiming, setClaiming] = useState(false);
  // Coverage is measured every few moves and again on release, so the moment
  // the cover is judged gone arrives several times. The claim is asked for once:
  // one card is one scratch, not one request per sample.
  const announced = useRef(false);

  // A fresh card in the same mount is a fresh card: the cover is back on, so
  // both the hint and the announcement start over.
  useEffect(() => {
    if (revealed) return;
    announced.current = false;
    setTouched(false);
  }, [revealed]);

  /**
   * Ask for the card to be claimed, once.
   *
   * The coin sound belongs to the gesture rather than to the claim, so it plays
   * here, under the finger; the prize's own cue fires in the caller, on the
   * server's answer. A refusal re-arms the threshold, so the card can be
   * scratched again instead of turning into dead artwork.
   */
  const claim = useCallback(async () => {
    if (claiming || revealed) return;
    setClaiming(true);
    const claimed = await onClaim();
    setClaiming(false);
    if (!claimed) announced.current = false;
  }, [claiming, onClaim, revealed]);

  // The cover's artwork is a file, so it arrives a frame or two after the sheet
  // does. Painting is keyed off this rather than off a timer.
  useEffect(() => {
    const image = new Image();
    image.src = BRAND_ASSETS.icon;
    image.onload = () => {
      tileRef.current = image;
      setTileReady(true);
    };
    return () => {
      image.onload = null;
    };
  }, []);

  // Repaint whenever the plate's box changes: the sheet's entrance, a rotation,
  // a window resize, or simply the first layout this canvas ever gets.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => paintCover(canvas, tileRef.current));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // And once more when the artwork itself arrives — the box has not changed, so
  // the observer has nothing to say.
  useEffect(() => {
    if (!tileReady) return;
    const canvas = canvasRef.current;
    if (canvas) paintCover(canvas, tileRef.current);
  }, [tileReady]);

  /** How much of the cover is gone, sampled on a coarse grid — 0 to 1. */
  const coverage = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0;
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    const step = 8;
    let gone = 0;
    let sampled = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        sampled += 1;
        if (data[(y * width + x) * 4 + 3] < 128) gone += 1;
      }
    }
    return sampled === 0 ? 0 : gone / sampled;
  }, []);

  /** Claim the card if enough of the cover has gone — and ask exactly once. */
  const check = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (announced.current) return;
      if (coverage(canvas) >= REVEAL_AT) {
        announced.current = true;
        void claim();
      }
    },
    [claim, coverage],
  );

  /** Rub a hole in the cover, and the line between the last hole and this one. */
  const eraseTo = useCallback(
    (canvas: HTMLCanvasElement, x: number, y: number, radius: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const previous = lastPoint.current;

      // A fast flick leaves gaping holes otherwise: the finger's path is drawn
      // as a run of overlapping circles rather than one circle per event.
      const gap = Math.max(radius / 2, 1);
      const from = previous ?? { x, y, radius };
      const distance = Math.hypot(x - from.x, y - from.y);
      const steps = Math.min(64, Math.max(1, Math.ceil(distance / gap)));

      ctx.globalCompositeOperation = "destination-out";
      for (let step = 0; step <= steps; step += 1) {
        const at = step / steps;
        ctx.beginPath();
        ctx.arc(from.x + (x - from.x) * at, from.y + (y - from.y) * at, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      lastPoint.current = { x, y, radius };
    },
    [],
  );

  const pointFrom = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width < 1 ? 1 : canvas.width / rect.width;
    return {
      x: (clientX - rect.left) * scale,
      y: (clientY - rect.top) * scale,
      radius: BRUSH * scale,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (revealed) return;
    // One stroke, one scrape: `cue` refuses a repeat inside its own gap, so
    // rubbing fast reads as continuous scratching rather than as a rattle.
    feedback.scratch();
    const canvas = event.currentTarget;
    // Capture so a stroke that leaves the card keeps erasing instead of
    // stopping dead at the edge. Best-effort: capture is a nicety, and a
    // browser that refuses it must not cost the user their scratch.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Unknown or already-released pointer — erase without the capture.
    }
    erasing.current = true;
    lastPoint.current = null;
    moves.current = 0;
    setTouched(true);
    const point = pointFrom(canvas, event.clientX, event.clientY);
    eraseTo(canvas, point.x, point.y, point.radius);
    check(canvas);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!erasing.current || revealed) return;
    const canvas = event.currentTarget;
    const point = pointFrom(canvas, event.clientX, event.clientY);
    eraseTo(canvas, point.x, point.y, point.radius);
    // Reading the whole canvas is the expensive part, so it happens every few
    // moves rather than on every one — the pointer-up check always runs.
    moves.current += 1;
    if (moves.current % 5 === 0) check(canvas);
  };

  const stopErasing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!erasing.current) return;
    erasing.current = false;
    lastPoint.current = null;
    const canvas = event.currentTarget;
    try {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
    check(canvas);
  };

  return (
    <div className={cx("mx-auto w-full", compact ? undefined : "max-w-[17rem]", className)}>
      <div
        className={cx(
          // Square, and square on any screen: one width, `aspect-square`, and a
          // cap so a wide sheet does not hand the card a block taller than the
          // sheet itself. It used to be a 176px-tall rectangle with `w-full`,
          // which meant a card that was wider than it was tall on a phone and
          // absurdly wide on a desktop.
          "relative aspect-square w-full overflow-hidden border-[1.5px] border-ink-900/75 bg-paper-100 shadow-[0_10px_24px_-18px_rgba(15,15,13,0.9)]",
          compact ? "rounded-[12px]" : "rounded-[16px]",
        )}
      >
        {/* The face of the card. The prize is deliberately absent while the
            cover is on: nothing in the document means nothing to read out of
            it, so a covered card cannot hand its number over early — not to a
            screenshot, not to a screen reader, and not to a cover that failed
            to paint. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          {/* A warm pool of light behind the coins, so the reveal has a subject
              rather than the coin floating on a flat sheet. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(244,212,156,0.85),rgba(249,227,192,0.35)_58%,transparent_78%)]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-2.5 rounded-[12px] border border-dashed border-ink-900/20"
          />
          {revealed ? (
            <>
              <Coin size={compact ? 44 : 64} className="relative animate-pop" />
              <p
                className={cx(
                  "relative font-display leading-none font-extrabold tracking-[-0.03em] text-ink-900 tabular-nums",
                  compact ? "text-[1.6rem]" : "text-[2.4rem]",
                )}
              >
                +{coins ?? 0}
              </p>
              <p
                className={cx(
                  "relative font-semibold tracking-[0.02em] text-ink-600",
                  compact ? "text-[10.5px]" : "text-[12px]",
                )}
              >
                {coins === 1 ? "coin added" : "coins added"}
              </p>
            </>
          ) : (
            <p
              className={cx(
                "relative font-display font-bold tracking-[0.14em] text-ink-400 uppercase",
                compact ? "text-[10px]" : "text-[12px]",
              )}
            >
              Keep scratching
            </p>
          )}
        </div>

        {/* What to do, on the cover, until the finger arrives — and then what is
            happening while the claim is in flight. It is an overlay rather than
            a label beside the card because the gesture is the whole
            interaction, and pointer-events-none keeps the stroke that dismisses
            it from being eaten by it. */}
        {!revealed && (claiming || !touched) ? (
          <span
            className={cx(
              "pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-ink-900/85 font-semibold whitespace-nowrap text-ink-25 shadow-[0_6px_14px_-8px_rgba(15,15,13,0.9)]",
              compact
                ? "bottom-2.5 px-2.5 py-1 text-[10px]"
                : "bottom-3.5 px-3.5 py-1.5 text-[11.5]",
            )}
          >
            {claiming ? "Claiming…" : "Scratch the logo"}
          </span>
        ) : null}

        <canvas
          ref={canvasRef}
          aria-hidden="true"
          // `touch-none` keeps a stroke from scrolling the sheet instead.
          className={cx(
            "absolute inset-0 block h-full w-full cursor-pointer touch-none transition-opacity duration-500",
            revealed && "pointer-events-none opacity-0",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopErasing}
          onPointerCancel={stopErasing}
        />
      </div>

      {/* The gesture is the interaction, but never the only way in: a keyboard
          or a screen reader gets the same card with one press, which claims it
          the same way a stroke does. */}
      {!revealed ? (
        <button
          type="button"
          disabled={claiming}
          onClick={() => void claim()}
          className="mt-2.5 w-full text-center text-[11.5px] font-semibold text-ink-500 underline decoration-ink-300 decoration-1 underline-offset-4 transition hover:text-ink-800 disabled:opacity-60"
        >
          {claiming ? "Claiming…" : "Reveal without scratching"}
        </button>
      ) : null}
    </div>
  );
}
