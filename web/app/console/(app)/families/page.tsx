import Link from 'next/link';
import { listConsoleFamilies } from 'db/read';
import { Label, PageHeader, Status, td, th } from '@/components/console/ui';
import { databaseUrl, personaName } from '@/lib/console/data';
import { callLength, channel, childrenText, maskPhone, shortDate, slotTime, weekdayDate, when } from '@/lib/console/format';

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const families = await listConsoleFamilies(databaseUrl());
  const selected = families.find((f) => f.id === sp.id) ?? families[0] ?? null;
  const persona = personaName();

  return (
    <>
      <PageHeader
        title="Families"
        lead={`What ${persona} remembers between calls. Caller id is a hint, not a login; form-entered numbers only open demo records.`}
      />
      <div className="flex flex-wrap items-start gap-5">
        <section className="card flex min-w-0 flex-[999_1_560px] flex-col overflow-x-auto">
          {families.length === 0 ? (
            <p className="p-6 text-[13px] text-text-muted">No families yet.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead className="text-text-muted">
                <tr>
                  <th className={th}>Family</th>
                  <th className={th}>Children</th>
                  <th className={th}>Last call</th>
                  <th className={th}>Identity</th>
                  <th className={th}>Latest booking</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => {
                  const last = f.calls[0];
                  const booking = f.bookings[0];
                  return (
                    <tr key={f.id} className={f.id === selected?.id ? 'bg-surface-muted' : 'hover:bg-surface-muted'}>
                      <td className={td}>
                        <Link href={`/console/families?id=${f.id}`} className="flex flex-col">
                          <span className="text-[14px] font-medium text-text">
                            {f.guardianName ?? 'Unknown caller'}
                            {f.isDemo && <span className="caption block font-normal">demo record</span>}
                          </span>
                          <span className="mono whitespace-nowrap text-text-muted">{maskPhone(f.phone) ?? 'no number'}</span>
                        </Link>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{childrenText(f.children) ?? 'None on record'}</td>
                      <td className={`${td} whitespace-nowrap`}>{last ? when(last.startedAt, now) : f.lastCallAt ? when(f.lastCallAt, now) : 'No calls'}</td>
                      <td className={`${td} mono`}>{last?.identitySource ?? 'n/a'}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {booking ? <Status dot="dot dot-on">{`${booking.programName}, ${shortDate(booking.startsAt)}`}</Status> : <Status dot="dot">No booking</Status>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        {selected && (
          <aside aria-label="Family detail" className="card flex min-w-0 max-w-[400px] flex-[1_1_320px] flex-col">
            <div className="flex flex-col gap-1 border-b border-border px-6 py-5">
              <h2 className="font-display text-[18px]" style={{ fontWeight: 600 }}>
                {selected.guardianName ?? 'Unknown caller'}
              </h2>
              <span className="text-[13px] text-text-muted">
                {[childrenText(selected.children), `${selected.calls.length} ${selected.calls.length === 1 ? 'call' : 'calls'}`, selected.isDemo ? 'demo record' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="flex flex-col gap-2 border-b border-divider px-6 py-5">
              <Label>Memory summary</Label>
              <p className="text-[14px] text-text-secondary">{selected.summary ?? 'No summary yet.'}</p>
              <span className="caption">Written by the model after each call. Read into {persona}&apos;s prompt when this family calls again.</span>
            </div>
            <div className="flex flex-col gap-2 border-b border-divider px-6 py-5">
              <Label>Bookings</Label>
              {selected.bookings.length === 0 && <span className="text-[13px] text-text-muted">No bookings.</span>}
              {selected.bookings.map((b) => (
                <div key={b.id} className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium">
                      {b.childName} · {b.programName} trial
                    </span>
                    <span className="caption">
                      {weekdayDate(b.startsAt)}, {slotTime(b.startsAt)} · {b.location} · {b.coach}
                    </span>
                  </div>
                  <span className="mono whitespace-nowrap text-text-muted">BK-{b.id.slice(0, 8).toUpperCase()}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 px-6 py-5">
              <Label>Calls</Label>
              {selected.calls.length === 0 && <span className="text-[13px] text-text-muted">No calls linked to this family.</span>}
              {selected.calls.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span>
                    {when(c.startedAt, now)} · {channel(c.direction).toLowerCase()}
                    {callLength(c.startedAt, c.endedAt) ? ` · ${callLength(c.startedAt, c.endedAt)}` : ''}
                  </span>
                  <Link href={`/console/calls/${c.id}`} className="font-medium text-accent hover:text-accent-strong">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
