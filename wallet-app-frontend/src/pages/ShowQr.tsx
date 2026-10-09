import { AppBar, AppShell } from "../components/AppShell";
import { VpaQr } from "../components/VpaQr";
import { IconInfo, IconScan } from "../components/ui/Icons";
import { EmptyState } from "../components/ui/States";
import { Spinner } from "../components/ui/Spinner";
import { useAppSession } from "../session/context";

export default function ShowQrPage() {
  const { profile, status } = useAppSession();

  return (
    <AppShell nav header={<AppBar title="My QR code" />}>
      <div className="space-y-4 px-4 pt-4 pb-6">
        {profile?.vpa ? (
          <>
            <p className="text-center text-[13px] leading-relaxed text-ink-500">
              Hold this up to be paid — any UPI scanner can read it, no typing needed.
            </p>

            <VpaQr vpa={profile.vpa} name={profile.name} />

            <p className="flex gap-2.5 rounded-[10px] border border-dashed border-ink-300 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-500">
              <IconInfo size={14} className="mt-px shrink-0 text-ink-400" />
              <span>
                The code encodes a standard <span className="font-mono">upi://pay</span>{" "}
                deep link, so any UPI scanner can read your{" "}
                <span className="font-mono">@okwault</span> handle straight off it — no
                typing needed.
              </span>
            </p>
          </>
        ) : status === "loading" ? (
          <div className="flex flex-col items-center gap-3 py-24 text-ink-400">
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
