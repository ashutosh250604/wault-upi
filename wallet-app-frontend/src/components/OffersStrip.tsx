import { useToast } from "../hooks/toast";
import { IconChevronRight } from "./ui/Icons";

interface Offer {
  title: string;
  body: string;
  gradient: string;
}

// Decorative: real UPI apps lead with offers, and the layout is part of the
// look — but nothing here is ever honoured, and tapping says so.
const OFFERS: Offer[] = [
  {
    title: "₹50 cashback",
    body: "On your next 3 transfers",
    gradient: "from-emerald-500 to-teal-600",
  },
  {
    title: "Refer & earn",
    body: "You and a friend both get ₹100",
    gradient: "from-brand-500 to-fuchsia-600",
  },
  {
    title: "Scan any QR",
    body: "Pay from your camera in seconds",
    gradient: "from-amber-500 to-orange-600",
  },
];

export function OffersStrip() {
  const toast = useToast();

  return (
    <section aria-label="Offers">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-bold tracking-tight text-slate-900">Offers for you</h2>
        <span className="text-[11.5px] font-semibold text-slate-400">Demo offers</span>
      </div>

      <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
        {OFFERS.map((offer) => (
          <button
            key={offer.title}
            type="button"
            onClick={() =>
              toast.info("Offers are decorative in this demo — no rewards are ever paid.")
            }
            className={`relative w-[13.5rem] shrink-0 snap-start overflow-hidden rounded-2xl bg-gradient-to-br ${offer.gradient} p-3.5 text-left text-white shadow-sm transition active:scale-[0.98]`}
          >
            <span className="pointer-events-none absolute -top-8 -right-6 size-20 rounded-full bg-white/15" />
            <p className="relative text-[14.5px] font-bold">{offer.title}</p>
            <p className="relative mt-0.5 text-[11.5px] leading-snug text-white/85">
              {offer.body}
            </p>
            <span className="relative mt-3 inline-flex items-center gap-0.5 text-[11.5px] font-semibold">
              Know more <IconChevronRight size={13} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
