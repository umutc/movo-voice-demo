import Link from 'next/link';
import { listConsoleCallbacks, listConsoleCalls, listConsolePrograms, listConsoleSlots, listCallMetrics } from 'db/read';
import { Sparkline } from '@/components/console/sparkline';
import { Empty, PageHeader, SectionHead, Status, td, th } from '@/components/console/ui';
import { databaseUrl, flag, personaName, readLastEvalRun } from '@/lib/console/data';
import { callLength, channel, clock, dayKey, longToday, maskPhone, outcomeDot, outcomeLabel, shortDate, slotTime, weekdayDate, when } from '@/lib/console/format';
import { summarizeMetrics } from '@/lib/console/stats';

export default async function DashboardPage() {
  const url = databaseUrl();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const [recent, callbacks, slots, programs, metricRows] = await Promise.all([
    listConsoleCalls(url, { since: new Date(now.getTime() - 8 * 86_400_000) }),
    listConsoleCallbacks(url),
    listConsoleSlots(url, now, weekAhead),
    listConsolePrograms(url),
    listCallMetrics(url),
  ]);
  const today = dayKey(now);
  const todays = recent.filter((c) => dayKey(c.startedAt) === today);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(now.getTime() - (6 - i) * 86_400_000)));
  const perDay = days.map((d) => recent.filter((c) => dayKey(c.startedAt) === d).length);
  const weekTotal = perDay.reduce((a, b) => a + b, 0);
  const seatsBooked = slots.reduce((s, x) => s + x.bookedCount, 0);
  const seatsTotal = slots.reduce((s, x) => s + x.capacity, 0);
  const lat = summarizeMetrics(metricRows.map((r) => r.metrics));
  const e2e = lat.metrics.find((m) => m.key === 'e2eMs');
  const evalRun = readLastEvalRun();
  const evalPassing = evalRun ? evalRun.scenarios.filter((s) => s.invariantsPass).length : null;
  const outbound = flag('FEATURE_OUTBOUND');
  const sms = flag('FEATURE_SMS');
  const listed = (todays.length > 0 ? todays : recent).slice(0, 8);

  return (
    <>
      <PageHeader
        title={longToday(now)}
        lead={`${personaName()} is answering on the parent site and the inbound number. Outbound calls are ${outbound ? 'on' : 'off'}, SMS is ${sms ? 'on' : 'off'}.`}
      />

      <section className="card flex flex-wrap items-center gap-8 px-7 py-6">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[56px] leading-none tracking-[-0.02em]" style={{ fontWeight: 700 }}>
            {todays.length}
          </span>
          <span className="text-[15px] text-text-muted">calls today</span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 text-[14px] text-text-secondary">
          <span>
            <strong className="text-text">{callbacks.length}</strong> {callbacks.length === 1 ? 'callback' : 'callbacks'} waiting
          </span>
          <span>
            <strong className="text-text">{seatsBooked}</strong> of {seatsTotal} trial seats booked, next 7 days
          </span>
          <span>
            <strong className="text-text">{programs.length}</strong> programs
          </span>
          {e2e && e2e.p50 !== null && (
            <span>
              <strong className="mono text-[14px] text-text">{e2e.p50.toLocaleString('en-US')} ms</strong> median reply, {e2e.n} turns
            </span>
          )}
          {evalRun && evalPassing !== null && (
            <span>
              <strong className="text-text">
                {evalRun.scenarios.length - evalRun.totals.invariantsFailed} of {evalRun.scenarios.length}
              </strong>{' '}
              {evalRun.profile} scenarios with all invariants passing, last eval {evalRun.date}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Sparkline values={perDay} label={`Calls per day, last seven days: ${perDay.join(', ')}`} />
          <span className="caption">
            {weekTotal} calls in the last 7 days, {shortDate(days[0]! + 'T12:00:00Z')} to {shortDate(days[6]! + 'T12:00:00Z')}
          </span>
        </div>
      </section>

      <section className="card flex flex-col">
        <SectionHead title={todays.length > 0 ? "Today's calls" : 'Recent calls'} href="/console/calls" linkLabel="Open calls" />
        {listed.length === 0 ? (
          <Empty>No calls in the last 8 days.</Empty>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="text-text-muted">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Family</th>
                <th className={th}>Channel</th>
                <th className={th}>Identity</th>
                <th className={th}>Outcome</th>
                <th className={`${th} text-right`}>Length</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((c) => (
                <tr key={c.id} className="hover:bg-surface-muted">
                  <td className={`${td} mono text-[13px]`}>
                    <Link href={`/console/calls/${c.id}`} className="text-accent hover:text-accent-strong">
                      {todays.length > 0 ? clock(c.startedAt) : when(c.startedAt, now)}
                    </Link>
                  </td>
                  <td className={td}>{c.guardianName ?? maskPhone(c.phone) ?? 'Unknown caller'}</td>
                  <td className={td}>{channel(c.direction)}</td>
                  <td className={`${td} mono`}>{c.identitySource}</td>
                  <td className={td}>
                    <Status dot={outcomeDot(c.outcome)}>{outcomeLabel(c.outcome)}</Status>
                  </td>
                  <td className={`${td} mono text-right`}>{callLength(c.startedAt, c.endedAt) ?? 'open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex flex-wrap gap-5">
        <section className="card flex min-w-0 flex-[1_1_360px] flex-col">
          <SectionHead title="Callbacks waiting" href="/console/callbacks" linkLabel="All callbacks" />
          {callbacks.length === 0 ? (
            <Empty>No callback requests.</Empty>
          ) : (
            <div className="flex flex-col pb-2">
              {callbacks.slice(0, 5).map((cb) => (
                <div key={cb.id} className="flex items-center justify-between gap-4 border-t border-divider px-6 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px] font-medium">
                      {cb.guardianName ?? 'Unknown caller'}, {cb.reason}
                    </span>
                    <span className="caption">
                      {cb.preferredTime ? `${cb.preferredTime} · ` : ''}requested {when(cb.createdAt, now).replace('Today', 'today')}
                    </span>
                  </div>
                  <Link href={`/console/callbacks?id=${cb.id}`} className="text-[13px] font-medium text-accent hover:text-accent-strong">
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card flex min-w-0 flex-[1_1_360px] flex-col">
          <SectionHead title="Trial seats, next 7 days" href="/console/programs" linkLabel="Programs" />
          {slots.length === 0 ? (
            <Empty>No trial slots in the next 7 days.</Empty>
          ) : (
            <div className="flex flex-col pb-2">
              {slots.slice(0, 8).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-4 border-t border-divider px-6 py-3 text-[13px]">
                  <span className="min-w-0 truncate">
                    {s.programName} · {weekdayDate(s.startsAt)}, {slotTime(s.startsAt)} · {s.location}
                  </span>
                  <span className={`mono shrink-0 ${s.bookedCount >= s.capacity ? 'text-warning' : 'text-text-muted'}`}>
                    {s.bookedCount} of {s.capacity}
                    {s.bookedCount >= s.capacity ? ', full' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
