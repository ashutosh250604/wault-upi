import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import type { IconScale, IconTone } from "../../lib/tiles";

/**
 * The app's one icon treatment.
 *
 * Before this, every screen invented its own: notifications used 36px tiles
 * with a tinted ring, transactions used 40px tiles with different tints, the
 * empty states used 48px tiles, the home quick actions used a dashed circle,
 * and the receipt's tick was a disc. Each looked fine alone and none of them
 * agreed, which is what "the icons feel inconsistent" actually means.
 *
 * The rules, and there are only four:
 *
 *   - **One box.** A rounded square of warm `paper-100` with a hairline of
 *     `ink-200` and a soft inner shadow, so it reads as a stamped impression on
 *     the page rather than a sticker on top of it. Same shape, same radius
 *     family, same ring, everywhere.
 *   - **One size per role.** `xs` for a tile that sits inside a line of text,
 *     `sm`/`md` for rows, `lg` for the illustration at the head of a state.
 *     Radius tracks the box, so the corners always look like the same corner.
 *   - **The glyph carries the meaning.** Colour is the *foreground's* job —
 *     money in is green, a reward is amber, a refusal is seal red, everything
 *     neutral is ink. The background never changes, which is what stops two
 *     rows of the same list looking like two different systems.
 *   - **`solid` for a statement, paper for a row.** A filled tile is reserved
 *     for the one thing a screen is telling you (a toast's tone, the receipt's
 *     tick), so a solid tile in a scrolling list never happens by accident.
 *
 * The glyph inside is the caller's, because a coin is not an SVG. Sizing it
 * from `TILE_GLYPH[scale]` and `TILE_STROKE` in `lib/tiles` is the whole
 * convention; both live there so a new tile cannot quietly invent its own
 * weight.
 */
const BOX: Record<IconScale, string> = {
  xs: "size-8 rounded-[8px]",
  sm: "size-9 rounded-[9px]",
  md: "size-10 rounded-[10px]",
  lg: "size-12 rounded-[12px]",
};

/** What the glyph is coloured: the only thing that varies between tiles. */
const GLYPH_TONE: Record<IconTone, string> = {
  credit: "text-credit-700",
  pending: "text-pending-600",
  seal: "text-seal-600",
  ink: "text-ink-800",
  muted: "text-ink-500",
};

/** A filled tile's own inks — the tone said once, at full strength. */
const SOLID_TONE: Record<IconTone, string> = {
  credit: "bg-credit-600 text-paper-25",
  pending: "bg-pending-600 text-paper-25",
  seal: "bg-seal-600 text-paper-25",
  ink: "bg-ink-900 text-ink-25",
  muted: "bg-ink-400 text-paper-25",
};

export function IconTile({
  children,
  tone = "muted",
  scale = "md",
  solid = false,
  className,
}: {
  children: ReactNode;
  /** The glyph's colour. The box does not change with it. */
  tone?: IconTone;
  scale?: IconScale;
  /** Fills the tile with the tone's ink, for a mark the screen is asserting. */
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center",
        BOX[scale],
        solid
          ? SOLID_TONE[tone]
          : cx(
              "bg-paper-100 shadow-[inset_0_1px_2px_rgba(15,15,13,0.06)] ring-1 ring-ink-200 ring-inset",
              GLYPH_TONE[tone],
            ),
        className,
      )}
    >
      {children}
    </span>
  );
}
