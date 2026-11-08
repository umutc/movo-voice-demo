import Link from 'next/link';
import { getConsoleCall, listConsoleCalls, type ConsoleCallRow } from 'db/read';
import { Label, PageHeader, Status } from '@/components/console/ui';
import { databaseUrl, personaName } from '@/lib/console/data';
import { callLength, channel, clock, dayKey, maskPhone, ms, outcomeDot, outcomeLabel, shortDate, slotTime, weekdayDate } from '@/lib/console/format';
import { percentile } from '@/lib/console/stats';

export interface CallFilters {
  outcome?: string;
  direction?: string;
  date?: string;
}

export function readFilters(sp: Record<string, string | string[] | undefined>): CallFilters {
  const one = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string) : undefined);
  const date = one('date');
  return { outcome: one('outcome'), direction: one('direction'), date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined };
}

function qs(f: CallFilters): string {
  const p = new URLSearchParams();
  if (f.outcome) p.set('outcome', f.outcome);
  if (f.direction) p.set('direction', f.direction);
  if (f.date) p.set('date', f.date);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function matches(c: ConsoleCallRow, f: CallFilters): boolean {
  if (f.outcome && (f.outcome === 'none' ? c.outcome !== null : c.outcome !== f.outcome)) return false;
  if (f.direction && c.direction !== f.direction) return false;
  if (f.date && dayKey(c.startedAt) !== f.date) return false;
  return true;
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex h-[34px] items-center rounded-[8px] border px-3 text-[13px] font-medium ${active ? 'border-text bg-text text-white' : 'border-control-border bg-surface text-text hover:border-text-muted'}`}
    >
      {children}
    </Link>
  );
}

export async function CallsView({ filters, selectedId }: { filters: CallFilters; selectedId?: string }) {
  const url = databaseUrl();
  const all = await listConsoleCalls(url);
  const byDateDir = all.filter((c) => matches(c, { ...filters, outcome: undefined }));
  const list = all.filter((c) => matches(c, filters));
  const id = selectedId ?? list[0]?.id;
  const detail = id ? await getConsoleCall(url, id) : null;
  const outcomes = ['booked', 'callback', 'inquiry'].filter((o) => all.some((c) => c.outcome === o));
  const directions = ['inbound', 'browser', 'outbound'].filter((d) => all.some((c) => c.direction === d));
  const q = qs(filters);

  return (
    <>
      <PageHeader title="Calls" lead={`${all.length} calls on record, newest first. Times are New York time.`}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip href={`/console/calls${qs({ ...filters, outcome: undefined })}`} active={!filters.outcome}>
            All, {byDateDir.length}
          </Chip>
          {outcomes.map((o) => (
            <Chip key={o} href={`/console/calls${qs({ ...filters, outcome: filters.outcome === o ? undefined : o })}`} active={filters.outcome === o}>
              {outcomeLabel(o)}, {byDateDir.filter((c) => c.outcome === o).length}
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {directions.map((d) => (
            <Chip key={d} href={`/console/calls${qs({ ...filters, direction: filters.direction === d ? undefined : d })}`} active={filters.direction === d}>
              {channel(d)}
            </Chip>
          ))}
          <form method="get" action="/console/calls" className="flex items-center gap-2">
            {filters.outcome && <input type="hidden" name="outcome" value={filters.outcome} />}
            {filters.direction && <input type="hidden" name="direction" value={filters.direction} />}
            <label className="sr-only" htmlFor="date">
              Day
            </label>
            <input id="date" type="date" name="date" defaultValue={filters.date} className="h-[34px] rounded-[8px] border border-control-border bg-surface px-2 text-[13px]" />
            <button type="submit" className="inline-flex h-[34px] items-center rounded-[8px] border border-control-border bg-surface px-3 text-[13px] font-medium hover:border-text-muted">
              Show day
            </button>
            {filters.date && (
              <Link href={`/console/calls${qs({ ...filters, date: undefined })}`} className="text-[13px] font-medium text-accent">
                Any day
              </Link>
            )}
          </form>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Call list" className="card flex max-h-[calc(100svh-180px)] w-[300px] shrink-0 flex-col overflow-y-auto">
          {list.length === 0 && <p className="p-5 text-[13px] text-text-muted">No calls match these filters.</p>}
          {list.map((c) => {
            const active = c.id === id;
            return (
              <Link
                key={c.id}
                href={`/console/calls/${c.id}${q}`}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col gap-1 border-b border-divider px-4 py-3 last:border-b-0 ${active ? 'border-l-[3px] border-l-accent bg-surface-muted' : 'hover:bg-surface-muted'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-medium">{c.guardianName ?? maskPhone(c.phone) ?? 'Unknown caller'}</span>
                  <span className="mono text-text-muted">
                    {dayKey(c.startedAt) === dayKey(new Date()) ? '' : `${shortDate(c.startedAt)} `}
                    {clock(c.startedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px] text-text-muted">
                  <span>{channel(c.direction)}</span>
                  <Status dot={outcomeDot(c.outcome)}>{outcomeLabel(c.outcome)}</Status>
                </div>
              </Link>
            );
          })}
        </section>
        {detail ? <CallDetail call={detail} /> : <section className="card flex-1 p-6 text-[13px] text-text-muted">Select a call to see its transcript.</section>}
      </div>
    </>
  );
}

type Detail = NonNullable<Awaited<ReturnType<typeof getConsoleCall>>>;

function CallDetail({ call }: { call: Detail }) {
  const persona = personaName();
  const caller = call.guardianName?.split(' ')[0] ?? 'Caller';
  const turns = call.metrics?.turns ?? [];
  const vals = (k: 'e2eMs' | 'llmTtftMs' | 'ttsTtfbMs') => turns.map((t) => t[k]).filter((v): v is number => typeof v === 'number');
  const e2e = vals('e2eMs');
  const latencyRows: [string, number | null][] = [
    ['End to end p50', percentile(e2e, 50)],
    ['End to end p95', percentile(e2e, 95)],
    ['LLM first token p50', percentile(vals('llmTtftMs'), 50)],
    ['TTS first byte p50', percentile(vals('ttsTtfbMs'), 50)],
  ];
  const shownLatency = latencyRows.filter(([, v]) => v !== null);
  const pipeline = call.metrics?.pipeline;
  const kids = call.children.map((k) => `${k.name} (${k.age})`).join(', ');
  const title = [call.guardianName ?? maskPhone(call.phone) ?? 'Unknown caller', kids ? `about ${kids}` : null].filter(Boolean).join(', ');
  const length = callLength(call.startedAt, call.endedAt);
  const spoken = call.transcript.filter((l) => l.role !== 'tool_output');

  return (
    <section aria-label="Call detail" className="card flex min-w-0 flex-[1_1_560px] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="font-display text-[18px]" style={{ fontWeight: 600 }}>
            {title}
          </h2>
          <span className="text-[13px] text-text-muted">
            {shortDate(call.startedAt)}, {clock(call.startedAt)}
            {length ? ` · ${length}` : ''} · {channel(call.direction).toLowerCase()} · room <span className="mono">{call.roomName}</span> · identity{' '}
            <span className="mono">{call.identitySource}</span>
            {call.familyIsDemo ? ', demo record' : ''}
          </span>
          <span className="text-[13px]">
            <Status dot={outcomeDot(call.outcome)}>
              {outcomeLabel(call.outcome)}
              {call.booking ? `, ${call.booking.childName} in ${call.booking.programName}, ${weekdayDate(call.booking.startsAt)} ${slotTime(call.booking.startsAt)}, ` : ''}
              {call.booking && <span className="mono">BK-{call.booking.id.slice(0, 8).toUpperCase()}</span>}
            </Status>
          </span>
        </div>
        {/* No link: Braintrust's SDK permalink needs the span row id, and calls.trace_id holds the root span id. */}
        {call.traceId && (
          <span className="flex flex-col gap-0.5 text-[13px]">
            <span className="text-text-muted">Braintrust trace id</span>
            <span className="mono break-all">{call.traceId}</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 border-border px-6 py-5 lg:border-r">
          <Label>Transcript</Label>
          {spoken.length === 0 && <span className="text-[13px] text-text-muted">No transcript was saved for this call.</span>}
          <div className="flex flex-col gap-2.5">
            {spoken.map((l, i) =>
              l.role === 'tool_call' ? (
                <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                  <span />
                  <span className="mono break-all text-text-muted">{l.text}</span>
                </div>
              ) : (
                <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 text-[14px]">
                  <span className={`text-[13px] font-semibold ${l.role === 'assistant' ? 'text-accent' : 'text-text'}`}>{l.role === 'assistant' ? persona : caller}</span>
                  <span>
                    {l.text}
                    {l.interrupted && <span className="caption"> (interrupted)</span>}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex flex-col gap-2 border-b border-divider px-6 py-5">
            <Label>Summary</Label>
            <p className="text-[14px] text-text-secondary">{call.summary ?? 'No summary was written for this call.'}</p>
          </div>
          {turns.length > 0 && (
            <div className="flex flex-col gap-2 border-b border-divider px-6 py-5">
              <Label>Latency, {turns.length} turns</Label>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                {shownLatency.map(([k, v]) => (
                  <Row key={k} k={k} v={ms(v)} />
                ))}
                <Row k="Interruptions" v={String(call.metrics?.interruptions ?? turns.filter((t) => t.interrupted).length)} />
              </div>
              {e2e.length > 0 && <span className="caption">End to end over {e2e.length} turns with a reported value.</span>}
            </div>
          )}
          {pipeline && (
            <div className="flex flex-col gap-2 px-6 py-5">
              <Label>Pipeline</Label>
              <div className="flex flex-col gap-1">
                {[pipeline.stt, pipeline.llm, pipeline.tts].filter(Boolean).map((m) => (
                  <span key={m} className="mono">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className="text-text-muted">{k}</span>
      <span className="mono text-right text-[13px]">{v}</span>
    </>
  );
}
