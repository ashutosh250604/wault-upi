/**
 * The WAULT brand, and where its artwork lives.
 *
 * The mark is supplied artwork, not something the app draws. Earlier this file
 * held a vector redrawing of it and every renderer (React, a 2D canvas,
 * reportlab, an SVG favicon) replayed those measurements — which meant four
 * slightly different logos and, at the sizes the app actually uses, four
 * approximations of the real one. It is now one set of high-resolution PNGs
 * under `public/brand/`, and they are the single source of truth:
 *
 *   wault-icon.png         the supplied app-icon tile (1024²), an RGBA rounded
 *                          square with transparent corners
 *   wault-mark.png         the supplied transparent landscape mark, cropped to
 *                          its own ink so nothing reserves dead space for it
 *   wault-coin-emblem.png  the supplied gold rupee coin — the rim cropped to
 *                          its own ink and squared off, so it fills the box
 *
 * Nothing above is redrawn or recoloured. The icon and the coin are the supplied
 * pixels at a smaller size; the mark is the supplied pixels with its empty
 * margins trimmed. Every one of them can therefore sit on the app's own paper
 * and on the dark hero without a pale square around it.
 *
 * When a surface can take the raw tile — the PDF statement's letterhead, the
 * tab icon — it should. The mark exists for surfaces that want the logo without
 * its plate: the login watermark, the QR centre, the scratch card's cover.
 */

/**
 * The one place the app writes its own name.
 *
 * There is no tagline here. "Your digital wallet" used to sit under the name in
 * the login lockup, which made the lockup two lines of type where one would do;
 * the mark and the name say the same thing more clearly on their own.
 */
export const BRAND = {
  name: "WAULT",
} as const;

/** Every file the brand is made of, as served paths. */
export const BRAND_ASSETS = {
  /** The app-icon tile: red, corner-rounded, transparent outside the corners. */
  icon: "/brand/wault-icon.png",
  /** The full mark — both phones, the ribbon, the medallion — transparent. */
  mark: "/brand/wault-mark.png",
  /**
   * The gold rupee coin, for every coin balance and reward row.
   *
   * This replaced the earlier medallion, which was the same artwork family as
   * the app icon and read as brand rather than as currency. The gold paisa is
   * unmistakably money and unmistakably ours, and it is the only coin file the
   * app ships — anything showing a coin shows this exact image.
   */
  coin: "/brand/wault-coin-emblem.png",
} as const;

/**
 * The paper the screens are cut out of. This mirrors `--color-paper-25` in
 * `index.css` — the QR canvas cannot read a CSS custom property without a
 * layout flush, so the hex is repeated here, and in
 * `wallet-app-backend/wallet/statement.py` as `PAPER`.
 */
export const SHEET = "#f9efc0";

/**
 * Width ÷ height of `wault-mark.png` — the file is 800×510, cropped to the
 * artwork's ink, so a caller reserving a box for the mark leaves no dead space
 * around it.
 */
export const MARK_ASPECT = 800 / 510;

/** The height of the mark when it is `width` wide. */
export function markHeight(width: number): number {
  return width / MARK_ASPECT;
}
