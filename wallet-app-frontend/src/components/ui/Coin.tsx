import { BRAND_ASSETS } from "../../lib/brand";
import { cx } from "../../lib/cx";

/**
 * The coin: `public/brand/wault-coin-emblem.png`, the supplied gold rupee.
 *
 * Not an icon drawn to look like a coin — this is the artwork, at the size a
 * balance, a reward row or a receipt needs, and it is the app's only coin. The
 * header chip, the coins sheet, the offer strip, a reward row and the scratch
 * card all render this file, so a coin cannot look like one thing on the home
 * screen and something else on the receipt.
 *
 * `muted` is for a coin that cannot be spent yet: the same artwork, greyed and
 * faded, so a disabled payout still reads as the same object rather than as a
 * different one.
 */
export function Coin({
  size = 18,
  muted = false,
  className,
}: {
  size?: number;
  muted?: boolean;
  className?: string;
}) {
  return (
    <img
      src={BRAND_ASSETS.coin}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={cx("block shrink-0 select-none", muted && "opacity-45 grayscale", className)}
      style={{ width: size, height: size }}
    />
  );
}
