/**
 * The icon tile's measurements — the numbers half of the icon design system.
 *
 * These live outside the component because the tile cannot size the glyph
 * itself: a coin is a picture and a lock is a line drawing, and the only one who
 * knows which is being placed is the call site. So the box is `IconTile`'s job
 * (shape, radius, ring, tone) and the glyph's size and weight come from here,
 * read by the call site, so a new row cannot quietly invent a 15px icon in a
 * 40px box or a 2.4 stroke beside a 1.75 one.
 *
 * `components/ui/IconTile.tsx` renders the box and documents the rules.
 */

/** The four sizes an icon tile is made in, one per job. */
export type IconScale = "xs" | "sm" | "md" | "lg";

/** How big the glyph inside each tile is. */
export const TILE_GLYPH: Record<IconScale, number> = {
  /** In a line of text — a toast's mark. */
  xs: 16,
  /** A list row with two lines of copy beside it. */
  sm: 17,
  /** A list row with a figure on the right. */
  md: 18,
  /** The illustration at the head of an empty or error state. */
  lg: 22,
};

/** The one stroke weight for a line glyph in a tile. */
export const TILE_STROKE = 1.9;

/**
 * What the glyph is coloured. The box never changes with it — that is the
 * whole point of the system: a green arrow and a red warning sit on the same
 * paper, so two rows of one list look like one list.
 */
export type IconTone = "credit" | "pending" | "seal" | "ink" | "muted";
