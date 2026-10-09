import { AppBar, AppShell } from "./AppShell";
import { Spinner } from "./ui/Spinner";

/** Shown while a lazily-loaded route (currently just the scanner) downloads. */
export function RouteFallback({ title, nav = false }: { title?: string; nav?: boolean }) {
  return (
    <AppShell nav={nav} header={title ? <AppBar title={title} /> : undefined}>
      <div className="flex flex-col items-center gap-3 py-24 text-ink-400">
        <Spinner size={24} />
        <p className="text-[13px]">Loading…</p>
      </div>
    </AppShell>
  );
}
