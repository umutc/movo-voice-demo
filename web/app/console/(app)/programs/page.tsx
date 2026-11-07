import { listConsolePrograms, listConsoleSlots } from 'db/read';
import { PageHeader, td, th } from '@/components/console/ui';
import { databaseUrl, personaName } from '@/lib/console/data';
import { shortDate, slotTime, weekdayDate } from '@/lib/console/format';

export default async function ProgramsPage() {
  const url = databaseUrl();
  const now = new Date();
  const [programs, upcoming] = await Promise.all([listConsolePrograms(url), listConsoleSlots(url, now, new Date(now.getTime() + 60 * 86_400_000))]);
  const twoWeeks = now.getTime() + 14 * 86_400_000;
  const cards = upcoming.filter((s) => new Date(s.startsAt).getTime() < twoWeeks);
  const seats = (s: { capacity: number; bookedCount: number }) => Math.max(0, s.capacity - s.bookedCount);

  return (
    <>
      <PageHeader
        title="Programs and trial slots"
        lead={`The only facts ${personaName()} may quote for prices, times and locations. Seats update inside the booking transaction.`}
      />
      <section className="card flex flex-col">
        <table className="w-full border-collapse text-[13px]">
          <thead className="text-text-muted">
            <tr>
              <th className={th}>Program</th>
              <th className={th}>Ages</th>
              <th className={th}>Days</th>
              <th className={th}>Location</th>
              <th className={th}>Monthly</th>
              <th className={th}>Next open trial slot</th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => {
              const next = upcoming.find((s) => s.programId === p.id && seats(s) > 0);
              return (
                <tr key={p.id}>
                  <td className={`${td} text-[14px] font-medium`}>{p.name}</td>
                  <td className={td}>
                    {p.ageMin} to {p.ageMax}
                  </td>
                  <td className={td}>{p.days}</td>
                  <td className={td}>{p.location}</td>
                  <td className={`${td} mono`}>${(p.monthlyPriceCents / 100).toLocaleString('en-US')}</td>
                  <td className={td}>
                    {next ? `${shortDate(next.startsAt)}, ${slotTime(next.startsAt)}, ${seats(next)} ${seats(next) === 1 ? 'seat' : 'seats'}` : 'No open slot in the next 60 days'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15px]" style={{ fontWeight: 600 }}>
          Trial slots, next 14 days
        </h2>
        {cards.length === 0 && <p className="text-[13px] text-text-muted">No trial slots in the next 14 days.</p>}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((s) => {
            const full = seats(s) === 0;
            const pct = s.capacity > 0 ? Math.min(100, Math.round((s.bookedCount / s.capacity) * 100)) : 0;
            return (
              <div key={s.id} className="card flex flex-col gap-3 p-5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">{s.programName}</span>
                  <span className="caption">
                    {weekdayDate(s.startsAt)} · {slotTime(s.startsAt)} · {s.location} · {s.coach}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-[3px] bg-divider" role="img" aria-label={`${s.bookedCount} of ${s.capacity} seats booked`}>
                  <div className={`h-full ${full ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="mono">
                    {s.bookedCount} of {s.capacity}
                  </span>
                  <span className={full ? 'text-warning' : 'text-text-muted'}>{full ? 'Full' : `${seats(s)} ${seats(s) === 1 ? 'seat' : 'seats'} left`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
