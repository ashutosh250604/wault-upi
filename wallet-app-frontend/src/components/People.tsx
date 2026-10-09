import type { Person } from "../types";
import { cx } from "../lib/cx";
import { avatarToneFor } from "../lib/avatar";
import { firstName } from "../lib/format";
import { personCaption, personLabel, type PeopleStatus } from "../lib/people";
import { Avatar } from "./ui/Avatar";
import { SectionTitle, TextLink } from "./ui/Card";
import { IconPlus, IconRefresh, IconStar } from "./ui/Icons";

export interface PersonTileProps {
  name: string | null;
  /** Stable value the avatar colour is derived from — the UPI ID, ideally. */
  seed: string;
  onClick: () => void;
  /** Small caption under the name, e.g. "You paid". */
  caption?: string | null;
  favourite?: boolean;
}

/** A tappable face: a stamp mark plus a first name, sized for a strip. */
export function PersonTile({ name, seed, onClick, caption, favourite }: PersonTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-[8px] px-1 py-0.5 transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
    >
      <span className="relative">
        <Avatar name={name} size="lg" tone={avatarToneFor(seed)} />
        {favourite ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-[4px] bg-seal-500 text-paper-25 ring-2 ring-paper-25"
          >
            <IconStar size={9} filled />
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-center text-[11.5px] font-semibold text-ink-700">
        {firstName(name)}
      </span>
      {caption ? (
        <span className="w-full truncate text-center text-[10px] text-ink-400">{caption}</span>
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
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-[8px] px-1 py-0.5 transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
    >
      <span className="flex size-12 items-center justify-center rounded-[10px] border border-dashed border-ink-300 text-ink-500">
        <IconPlus size={20} />
      </span>
      <span className="w-full truncate text-center text-[11.5px] font-semibold text-ink-500">
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
          <div className="size-12 animate-pulse rounded-[10px] bg-ink-200/70" />
          <div className="h-2.5 w-12 animate-pulse rounded-[4px] bg-ink-200/70" />
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
        className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-ink-300 py-4 text-[12.5px] font-semibold text-ink-500 transition hover:border-ink-400 hover:text-ink-700"
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
        <p className="py-3 text-[12.5px] text-ink-500">
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
      <SectionTitle
        action={
          onSeeAll ? (
            <TextLink
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onSeeAll();
              }}
            >
              All contacts
            </TextLink>
          ) : undefined
        }
      >
        Send money to
      </SectionTitle>
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
