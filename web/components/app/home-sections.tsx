import type { HomeCatalog } from 'db/read';
import { slotTime, weekdayDate } from '@/lib/console/format';

const price = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;
const seats = (n: number) => `${n} ${n === 1 ? 'seat' : 'seats'} left`;

/** Programs and coaches behind the header nav. All values come from the programs and trial_slots tables. */
export function HomeSections({ catalog }: { catalog: HomeCatalog }) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-10 pb-12">
      {catalog.programs.length > 0 && (
        <section id="programs" aria-labelledby="programs-title" className="flex scroll-mt-6 flex-col gap-3">
          <h2 id="programs-title" className="font-display m-0 text-[22px] font-semibold">
            Programs
          </h2>
          <ul className="card m-0 flex list-none flex-col p-0">
            {catalog.programs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-divider px-6 py-4 last:border-b-0">
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{p.name}</span>
                  <span className="text-[13px] text-text-secondary">
                    Ages {p.ageMin} to {p.ageMax}, {p.location}, {p.days}
                  </span>
                </div>
                <div className="flex flex-[0_1_auto] flex-col gap-0.5 sm:items-end">
                  <span className="text-[14px] font-medium">{price(p.monthlyPriceCents)} a month</span>
                  <span className="caption">
                    {p.nextOpenSlot
                      ? `Next trial ${weekdayDate(p.nextOpenSlot.startsAt)}, ${slotTime(p.nextOpenSlot.startsAt)}, ${seats(p.nextOpenSlot.seatsLeft)}`
                      : 'No open trial slot yet'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {catalog.coaches.length > 0 && (
        <section id="coaches" aria-labelledby="coaches-title" className="flex scroll-mt-6 flex-col gap-3">
          <h2 id="coaches-title" className="font-display m-0 text-[22px] font-semibold">
            Coaches
          </h2>
          <p className="caption m-0 text-[13px]">Coaches on the upcoming trial classes.</p>
          <ul className="card m-0 grid list-none grid-cols-1 overflow-hidden p-0 sm:grid-cols-2">
            {catalog.coaches.map((c) => (
              <li key={c.name} className="-mb-px flex flex-col gap-0.5 border-b border-divider px-6 py-4">
                <span className="text-[15px] font-semibold">{c.name}</span>
                <span className="text-[13px] text-text-secondary">{c.programs.join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
