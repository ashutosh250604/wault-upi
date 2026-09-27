import { AppBar, AppShell } from "../components/AppShell";
import { VpaQr } from "../components/VpaQr";
import { Card } from "../components/ui/Card";
import { IconInfo, IconScan } from "../components/ui/Icons";
import { EmptyState } from "../components/ui/States";
import { Spinner } from "../components/ui/Spinner";
import { useAppSession } from "../session/context";

export default function ShowQrPage() {
  const { profile, status } = useAppSession();

  return (
    <AppShell nav header={<AppBar title="My QR code" />}>
      <div className="space-y-5 px-5 pt-5 pb-6">
        {profile?.vpa ? (
          <>
            <p className="text-center text-[13.5px] leading-relaxed text-slate-500">
              Show this code or your UPI ID — anyone with the PocketPay scanner can pay
              you.
            </p>

            <Card className="py-6">
              <VpaQr vpa={profile.vpa} name={profile.name} />
            </Card>

            <Card tone="muted" className="flex gap-2.5">
              <IconInfo size={16} className="mt-px shrink-0 text-slate-400" />
              <p className="text-[12.5px] leading-relaxed text-slate-600">
                The code encodes a standard <span className="font-mono">upi://pay</span>{" "}
                deep link, but <span className="font-mono">@demoupi</span> handles don't
                exist outside this demo — a real UPI app will simply say the ID is
                invalid. No money can ever move.
              </p>
            </Card>
          </>
        ) : status === "loading" ? (
          <div className="flex flex-col items-center gap-3 py-24 text-slate-400">
            <Spinner size={24} />
            <p className="text-[13px]">Loading your UPI ID…</p>
          </div>
        ) : (
          <EmptyState
            icon={<IconScan size={22} />}
            title="No UPI ID yet"
            description="Finish setting up your profile to get a scannable address."
          />
        )}
      </div>
    </AppShell>
  );
}
