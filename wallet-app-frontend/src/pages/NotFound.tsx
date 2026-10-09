import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TILE_STROKE } from "../lib/tiles";
import { IconTile } from "../components/ui/IconTile";
import { IconWarning } from "../components/ui/Icons";

export default function NotFoundPage() {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <IconTile tone="seal" scale="lg" className="size-14 rounded-[14px]">
          <IconWarning size={26} strokeWidth={TILE_STROKE} />
        </IconTile>
        <p className="mt-5 font-display text-[24px] font-extrabold tracking-tight text-ink-900">
          Page not found
        </p>
        <p className="mt-2 max-w-xs text-[13.5px] leading-relaxed text-ink-500">
          That link doesn't exist in WAULT. It may have been a typo, or the screen was
          renamed.
        </p>
        <Card className="mt-6 w-full max-w-xs" tone="muted">
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            Tip: use the bottom tabs to get back to your wallet.
          </p>
        </Card>
        <Link to="/home" className="mt-5">
          <Button size="lg">Back to wallet</Button>
        </Link>
      </div>
    </AppShell>
  );
}
