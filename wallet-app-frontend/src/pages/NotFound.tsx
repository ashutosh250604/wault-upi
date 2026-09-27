import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { IconWarning } from "../components/ui/Icons";

export default function NotFoundPage() {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <IconWarning size={26} />
        </span>
        <p className="mt-4 text-[22px] font-bold tracking-tight text-slate-900">
          Page not found
        </p>
        <p className="mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-slate-500">
          That link doesn't exist in PocketPay. It may have been a typo, or the screen was
          renamed.
        </p>
        <Card className="mt-6 w-full max-w-xs" tone="muted">
          <p className="text-[12.5px] text-slate-600">
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
