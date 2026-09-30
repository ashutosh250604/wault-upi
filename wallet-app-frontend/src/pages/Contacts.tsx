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
import { Card } from "../components/ui/Card";
import { Field, TextInput } from "../components/ui/Field";
import { IconPlus, IconTrash, IconUser } from "../components/ui/Icons";
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
      <li key={contact.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => startPayment(contact)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-2.5 text-left transition hover:bg-slate-50 active:bg-slate-100"
        >
          <Avatar
            name={label}
            size="lg"
            tone={avatarToneFor(contact.vpa ?? contact.mobile ?? String(contact.user_id))}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14.5px] font-semibold text-slate-900">
                {label}
              </span>
              {contact.is_favourite ? (
                <span className="shrink-0 text-[11px] text-amber-400" aria-label="Favourite">
                  ★
                </span>
              ) : null}
            </span>
            <span className="block truncate text-[12px] text-slate-500">
              {showRegistered ? `${contact.name} · ` : ""}
              {personHandle(contact)}
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
          className={`rounded-full p-2 transition ${
            contact.is_favourite
              ? "text-amber-400 hover:bg-amber-50"
              : "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
          }`}
        >
          <span aria-hidden="true">★</span>
        </button>

        <button
          type="button"
          onClick={() => setPendingRemoval(contact)}
          aria-label={`Remove ${label}`}
          className="rounded-full p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
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
              className="rounded-full p-2 text-brand-700 transition hover:bg-brand-50"
            >
              <IconPlus size={19} />
            </button>
          }
        />
      }
      footer={
        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
      <div className="space-y-4 px-5 pt-4 pb-6">
        {contacts === null && error === null ? (
          <div className="space-y-3" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="size-12 animate-pulse rounded-full bg-slate-200/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200/80" />
                  <div className="h-3 w-40 animate-pulse rounded bg-slate-200/80" />
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

        {empty ? (
          <Card>
            <EmptyState
              icon={<IconUser size={22} />}
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
          </Card>
        ) : null}

        {favourites.length > 0 ? (
          <section>
            <h2 className="mb-1 px-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
              Favourites
            </h2>
            <ul>{favourites.map(renderRow)}</ul>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section>
            <h2 className="mb-1 px-1 text-[11.5px] font-bold tracking-wide text-slate-400 uppercase">
              {favourites.length > 0 ? "All contacts" : "Contacts"}
            </h2>
            <ul>{others.map(renderRow)}</ul>
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
          className="w-full rounded-2xl border border-dashed border-slate-200 py-3.5 text-[13px] font-semibold text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
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
        <p className="text-[13.5px] leading-relaxed text-slate-600">
          Removing a contact only clears your own address book. It never touches your
          transaction history, and it doesn&apos;t tell the other person anything.
        </p>
      </Sheet>
    </AppShell>
  );
}
