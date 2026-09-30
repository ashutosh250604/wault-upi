import type { Person } from "../types";
import { cx } from "../lib/cx";
import { avatarToneFor } from "../lib/avatar";
import { firstName } from "../lib/format";
import { personCaption, personLabel, type PeopleStatus } from "../lib/people";
import { Avatar } from "./ui/Avatar";
import { IconPlus, IconRefresh } from "./ui/Icons";

export interface PersonTileProps {
  name: string | null;
  /** Stable value the avatar colour is derived from — the UPI ID, ideally. */
  seed: string;
  onClick: () => void;
  /** Small caption under the name, e.g. "You paid". */
  caption?: string | null;
  favourite?: boolean;
}

/** A tappable face: avatar plus a first name, sized for a horizontal strip. */
export function PersonTile({ name, seed, onClick, caption, favourite }: PersonTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-1 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <span className="relative">
        <Avatar name={name} size="lg" tone={avatarToneFor(seed)} />
        {favourite ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-white text-[9px] text-amber-400 shadow-sm ring-1 ring-slate-100"
          >
            ★
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-center text-[11.5px] font-semibold text-slate-700">
        {firstName(name)}
      </span>
      {caption ? (
        <span className="w-full truncate text-center text-[10px] text-slate-400">{caption}</span>
      ) : null}
    </button>
  );
}

/** The "add someone new" tile that closes every people strip. */
export function AddPersonTile({ onClick, label = "New" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-1 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <span className="flex size-12 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400">
        <IconPlus size={20} />
      </span>
      <span className="w-full truncate text-center text-[11.5px] font-semibold text-slate-500">
        {label}
      </span>
    </button>
  );
}

/** Placeholder faces while the strip loads, so the layout doesn't jump. */
export function PeopleStripSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-2 py-1">
          <div className="size-12 animate-pulse rounded-full bg-slate-200/80" />
          <div className="h-2.5 w-12 animate-pulse rounded bg-slate-200/80" />
        </div>
      ))}
    </div>
  );
}

export interface PeopleStripProps {
  people: Person[] | null;
  status: PeopleStatus;
  onSelect: (person: Person) => void;
  onAdd?: () => void;
  addLabel?: string;
  showCaption?: boolean;
  onRetry?: () => void;
}

/** Horizontal, snap-scrolling row of faces — the signature UPI home element. */
export function PeopleStrip({
  people,
  status,
  onSelect,
  onAdd,
  addLabel,
  showCaption = false,
  onRetry,
}: PeopleStripProps) {
  if (status === "loading" && people === null) return <PeopleStripSkeleton />;

  if (status === "error" && people === null) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-4 text-[12.5px] font-semibold text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
      >
        <IconRefresh size={15} /> Couldn&apos;t load your contacts — tap to retry
      </button>
    );
  }

  const list = people ?? [];

  return (
    <div className="no-scrollbar -mx-5 flex snap-x gap-1 overflow-x-auto px-5">
      {onAdd ? <AddPersonTile onClick={onAdd} label={addLabel} /> : null}
      {list.map((person) => (
        <PersonTile
          key={person.user_id}
          name={personLabel(person)}
          seed={person.vpa ?? person.mobile ?? String(person.user_id)}
          favourite={person.is_favourite}
          caption={showCaption ? personCaption(person) : null}
          onClick={() => onSelect(person)}
        />
      ))}
      {list.length === 0 && !onAdd ? (
        <p className="py-3 text-[12.5px] text-slate-500">
          Nobody here yet — add a contact to pay them in one tap.
        </p>
      ) : null}
    </div>
  );
}

export interface PeopleSectionProps {
  people: Person[] | null;
  status: PeopleStatus;
  onSelect: (person: Person) => void;
  onAdd: () => void;
  onRetry: () => void;
  onSeeAll?: () => void;
  className?: string;
}

/** The home-screen block: heading, "All contacts" link and the strip itself. */
export function PeopleSection({
  people,
  status,
  onSelect,
  onAdd,
  onRetry,
  onSeeAll,
  className,
}: PeopleSectionProps) {
  return (
    <section aria-label="Send money to" className={cx("space-y-1", className)}>
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-bold tracking-tight text-slate-900">Send money to</h2>
        {onSeeAll ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            All contacts
          </button>
        ) : null}
      </div>
      <PeopleStrip
        people={people}
        status={status}
        onSelect={onSelect}
        onAdd={onAdd}
        onRetry={onRetry}
      />
    </section>
  );
}
