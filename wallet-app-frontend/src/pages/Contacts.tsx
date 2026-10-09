import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Contact } from "../types";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { avatarToneFor } from "../lib/avatar";
import { personHandle, personLabel } from "../lib/people";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { useToast } from "../hooks/toast";
import { useAppSession } from "../session/context";
import { AppBar, AppShell } from "../components/AppShell";
import { AddContactSheet } from "../components/AddContactSheet";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Card, SectionTitle } from "../components/ui/Card";
import { Field, TextInput } from "../components/ui/Field";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { IconPlus, IconStar, IconTrash, IconUser } from "../components/ui/Icons";
import { Sheet } from "../components/ui/Sheet";
import { EmptyState, ErrorState } from "../components/ui/States";

/**
 * The address book. Rows behave the way a payments app trains you to expect:
 * tapping the person pays them, and the small controls on the right are for
 * curating the list (favourite, remove).
 */
export default function ContactsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { userId } = useAppSession();
  const { startPayment } = usePayeeResolution();

  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The home strip's "New" tile deep-links here with { add: true }.
  const location = useLocation();
  const [adding, setAdding] = useState(
    () => (location.state as { add?: boolean } | null)?.add === true,
  );
  const [pendingRemoval, setPendingRemoval] = useState<Contact | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = async (signal?: AbortSignal) => {
    try {
      setContacts(await api.contacts(signal));
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const { favourites, others, matches } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (contacts ?? []).filter((contact) => {
      if (!needle) return true;
      return [contact.name, contact.nickname, contact.vpa, contact.mobile]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });

    return {
      matches: list,
      favourites: list.filter((contact) => contact.is_favourite),
      others: list.filter((contact) => !contact.is_favourite),
    };
  }, [contacts, query]);

  if (!userId) return <Navigate to="/login" replace />;

  const toggleFavourite = async (contact: Contact) => {
    const next = !contact.is_favourite;
    // Optimistic: starring must feel instant; the server is the tiebreaker.
    setContacts((current) =>
      (current ?? []).map((item) =>
        item.id === contact.id ? { ...item, is_favourite: next } : item,
      ),
    );
    try {
      const saved = await api.updateContact(contact.id, { is_favourite: next });
      setContacts((current) =>
        (current ?? []).map((item) => (item.id === saved.id ? saved : item)),
      );
      feedback.tap();
    } catch (err) {
      setContacts((current) =>
        (current ?? []).map((item) =>
          item.id === contact.id ? { ...item, is_favourite: !next } : item,
        ),
      );
      toast.error(errorMessage(err));
    }
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await api.removeContact(pendingRemoval.id);
      setContacts((current) =>
        (current ?? []).filter((item) => item.id !== pendingRemoval.id),
      );
      toast.success(`${personLabel(pendingRemoval)} removed`);
      setPendingRemoval(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(false);
    }
  };

  const renderRow = (contact: Contact) => {
    const label = personLabel(contact);
    const showRegistered = Boolean(contact.nickname && contact.name);

    return (
      <li key={contact.id} className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => startPayment(contact)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] px-1.5 py-2.5 text-left transition hover:bg-paper-100 active:bg-paper-200"
        >
          <Avatar
            name={label}
            size="lg"
            tone={avatarToneFor(contact.vpa ?? contact.mobile ?? String(contact.user_id))}
          />
          <span className="min-w-0 flex-1">
            <span className="truncate font-display text-[14.5px] font-bold tracking-tight text-ink-900">
              {label}
            </span>
            {/* The handle is what you actually pay, so it never truncates; the
                registered name is the part that gives way on narrow screens. */}
            <span className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-500">
              <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
                {personHandle(contact)}
              </span>
              {showRegistered ? (
                <>
                  <span aria-hidden="true" className="h-3 w-px shrink-0 bg-ink-200" />
                  <span className="min-w-0 truncate">{contact.name}</span>
                </>
              ) : null}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => void toggleFavourite(contact)}
          aria-label={
            contact.is_favourite
              ? `Remove ${label} from favourites`
              : `Add ${label} to favourites`
          }
          aria-pressed={contact.is_favourite}
          className={`rounded-[6px] p-2 transition ${
            contact.is_favourite
              ? "text-seal-500 hover:bg-seal-50"
              : "text-ink-300 hover:bg-paper-100 hover:text-ink-600"
          }`}
        >
          <IconStar size={16} filled={contact.is_favourite} />
        </button>

        <button
          type="button"
          onClick={() => setPendingRemoval(contact)}
          aria-label={`Remove ${label}`}
          className="rounded-[6px] p-2 text-ink-300 transition hover:bg-seal-50 hover:text-seal-600"
        >
          <IconTrash size={16} />
        </button>
      </li>
    );
  };

  const empty = contacts !== null && contacts.length === 0;

  return (
    <AppShell
      header={
        <AppBar
          title="Contacts"
          showBack
          right={
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-label="Add contact"
              className="rounded-[6px] p-2 text-ink-900 transition hover:bg-paper-100"
            >
              <IconPlus size={19} />
            </button>
          }
        />
      }
      footer={
        <div className="shrink-0 border-t border-ink-200 bg-paper-50 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            fullWidth
            leftIcon={<IconPlus size={18} />}
            onClick={() => setAdding(true)}
          >
            Add new contact
          </Button>
        </div>
      }
    >
      <div className="space-y-5 px-5 pt-4 pb-6">
        {contacts === null && error === null ? (
          <div className="space-y-3" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="size-12 animate-pulse rounded-[10px] bg-paper-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 animate-pulse rounded-[3px] bg-paper-200" />
                  <div className="h-3 w-40 animate-pulse rounded-[3px] bg-paper-200" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {error && contacts === null ? (
          <Card>
            <ErrorState message={error} onRetry={() => void load()} />
          </Card>
        ) : null}

        {contacts === null || empty ? null : (
          <Field label="Search contacts">
            {({ id }) => (
              <TextInput
                id={id}
                type="search"
                placeholder="Name, number or UPI ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </Field>
        )}

        {/* The empty state is a warm panel, not a bright slip.

            It used to be the default `Card` — the brightest sheet in the
            palette, a full screen of near-white behind three lines of copy,
            which is the loudest the emptiest screen in the app ever got. It is
            now the same warm ochre as the wells and the muted notes, with an
            inked tile stamped into it, so "empty" reads as a quiet, deliberate
            state rather than as a page that failed to load. */}
        {empty ? (
          <div className="overflow-hidden rounded-[12px] border-[1.5px] border-ink-900/25 bg-paper-100">
            <EmptyState
              icon={<IconUser size={TILE_GLYPH.lg} strokeWidth={TILE_STROKE} />}
              iconTone="ink"
              iconSolid
              title="No contacts yet"
              description="Save the people you pay often and they'll appear on your home screen for one-tap payments."
              action={
                <Button
                  leftIcon={<IconPlus size={16} />}
                  onClick={() => setAdding(true)}
                >
                  Add your first contact
                </Button>
              }
            />
          </div>
        ) : null}

        {favourites.length > 0 ? (
          <section className="space-y-1">
            <SectionTitle
              className="px-1"
              action={
                <span className="font-mono text-[11.5px] tabular-nums text-ink-400">
                  {favourites.length}
                </span>
              }
            >
              Favourites
            </SectionTitle>
            <ul className="divide-y divide-ink-200/70">{favourites.map(renderRow)}</ul>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section className="space-y-1">
            <SectionTitle
              className="px-1"
              action={
                <span className="font-mono text-[11.5px] tabular-nums text-ink-400">
                  {others.length}
                </span>
              }
            >
              {favourites.length > 0 ? "Everyone else" : "Contacts"}
            </SectionTitle>
            <ul className="divide-y divide-ink-200/70">{others.map(renderRow)}</ul>
          </section>
        ) : null}

        {contacts !== null && matches.length === 0 && !empty ? (
          <EmptyState
            title="No matches"
            description={`Nobody in your contacts matches “${query.trim()}”.`}
            action={
              <Button variant="secondary" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : null}

        <button
          type="button"
          onClick={() => navigate("/scan")}
          className="w-full rounded-[8px] border border-dashed border-ink-300 py-3.5 text-[13px] font-semibold text-ink-500 transition hover:border-ink-400 hover:text-ink-700"
        >
          After a scan? Pay any QR code instead
        </button>
      </div>

      <AddContactSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(contact) =>
          setContacts((current) => {
            const list = current ?? [];
            return list.some((item) => item.id === contact.id)
              ? list.map((item) => (item.id === contact.id ? contact : item))
              : [...list, contact];
          })
        }
      />

      <Sheet
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        title={pendingRemoval ? `Remove ${personLabel(pendingRemoval)}?` : "Remove contact"}
        description="You can always save them again from their mobile number."
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setPendingRemoval(null)}
            >
              Keep
            </Button>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={removing}
              onClick={() => void confirmRemoval()}
            >
              Remove
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-ink-600">
          Removing a contact only clears your own address book. It never touches your
          activity, and it doesn&apos;t tell the other person anything.
        </p>
      </Sheet>
    </AppShell>
  );
}
