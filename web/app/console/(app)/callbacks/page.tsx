import Link from 'next/link';
import { listConsoleCallbacks } from 'db/read';
import { Label, PageHeader, td, th } from '@/components/console/ui';
import { databaseUrl, personaName } from '@/lib/console/data';
import { clock, maskPhone, when } from '@/lib/console/format';

export default async function CallbacksPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const callbacks = await listConsoleCallbacks(databaseUrl());
  const selected = callbacks.find((c) => c.id === sp.id) ?? callbacks[0] ?? null;
  const persona = personaName();

  return (
    <>
      <PageHeader
        title="Callbacks"
        lead={`Questions ${persona} could not answer from the schedule. A coach calls back; ${persona} never promises a price or policy. ${callbacks.length} in the queue.`}
      />
      <div className="flex flex-wrap items-start gap-5">
        <section className="card flex min-w-0 flex-[999_1_560px] flex-col overflow-x-auto">
          {callbacks.length === 0 ? (
            <p className="p-6 text-[13px] text-text-muted">No callback requests yet.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead className="text-text-muted">
                <tr>
                  <th className={th}>Family</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Preferred time</th>
                  <th className={th}>Requested</th>
                </tr>
              </thead>
              <tbody>
                {callbacks.map((cb) => (
                  <tr key={cb.id} className={cb.id === selected?.id ? 'bg-surface-muted' : 'hover:bg-surface-muted'}>
                    <td className={td}>
                      <Link href={`/console/callbacks?id=${cb.id}`} className="flex flex-col">
                        <span className="whitespace-nowrap text-[14px] font-medium text-text">{cb.guardianName ?? 'Unknown caller'}</span>
                        <span className="mono whitespace-nowrap text-text-muted">{maskPhone(cb.phone) ?? 'no number'}</span>
                      </Link>
                    </td>
                    <td className={td}>{cb.reason}</td>
                    <td className={td}>{cb.preferredTime ?? 'Not given'}</td>
                    <td className={`${td} whitespace-nowrap`}>{when(cb.createdAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {selected && (
          <aside aria-label="Callback detail" className="card flex min-w-0 max-w-[400px] flex-[1_1_320px] flex-col">
            <div className="flex flex-col gap-1 border-b border-border px-6 py-5">
              <h2 className="font-display text-[18px]" style={{ fontWeight: 600 }}>
                {selected.guardianName ?? 'Unknown caller'}
              </h2>
              <span className="text-[13px] text-text-muted">
                {selected.reason}
                {selected.preferredTime ? ` · ${selected.preferredTime}` : ''}
              </span>
            </div>
            <div className="flex flex-col gap-3 px-6 py-5">
              {selected.call ? (
                <>
                  <Label>From the call, {clock(selected.call.startedAt)}</Label>
                  {selected.call.excerpt.length === 0 && <span className="text-[13px] text-text-muted">The call transcript has no request_human_callback line.</span>}
                  {selected.call.excerpt.map((l, i) =>
                    l.role === 'tool_call' ? (
                      <span key={i} className="mono break-all text-text-muted">
                        {l.text}
                      </span>
                    ) : (
                      <div key={i} className="flex flex-col gap-0.5 text-[14px]">
                        <span className={`text-[12px] font-semibold ${l.role === 'assistant' ? 'text-accent' : 'text-text'}`}>
                          {l.role === 'assistant' ? persona : (selected.guardianName?.split(' ')[0] ?? 'Caller')}
                        </span>
                        <span>{l.text}</span>
                      </div>
                    ),
                  )}
                  <Link href={`/console/calls/${selected.call.id}`} className="text-[13px] font-medium text-accent hover:text-accent-strong">
                    Open the full call
                  </Link>
                </>
              ) : (
                <span className="text-[13px] text-text-muted">No call row matches the time of this request.</span>
              )}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
