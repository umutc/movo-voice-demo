'use client';

import { useEffect, useState } from 'react';
import { clockTime, describeTool, longDate, memoryOutcome, offsetSeconds, shortId } from '@/lib/call-format';
import { formatClock, SiteHeader } from './site-header';
import type { StateSnapshot, TranscriptLine } from './types';

interface CallViewData {
  call: { id: string; identitySource: string; startedAt: string; endedAt: string | null; outcome: string | null; summary: string | null; familyId: string | null };
  family: { guardianName: string | null; isDemo: boolean; summary: string | null } | null;
  booking: { id: string; childName: string; childAge: number; programName: string; location: string; startsAt: string; coach: string; guardianName: string | null } | null;
}

interface Props {
  personaName: string;
  guardianName: string;
  snapshot: StateSnapshot | null;
  transcript: TranscriptLine[];
  seconds: number;
  onRestart: () => void;
}

export function DoneView({ personaName, guardianName, snapshot, transcript, seconds, onRestart }: Props) {
  const callId = snapshot?.callId ?? null;
  const [data, setData] = useState<CallViewData | null>(null);
  const [tries, setTries] = useState(0);

  // The summary is written a few seconds after hangup; poll the call row until the agent closes it.
  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/calls/${callId}`, { cache: 'no-store' });
        if (!r.ok) return;
        const json = (await r.json()) as CallViewData;
        if (cancelled) return;
        setData(json);
        // closeCall writes endedAt and the summary in one update; once endedAt is set, nothing more is coming.
        if (!json.call.endedAt && tries < 10) setTimeout(() => setTries((t) => t + 1), 2500);
      } catch {
        if (!cancelled && tries < 10) setTimeout(() => setTries((t) => t + 1), 2500);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [callId, tries]);

  const booking = data?.booking ?? null;
  const headline = booking
    ? `${booking.childName}'s free trial is set for ${longDate(booking.startsAt)}.`
    : snapshot?.outcome === 'callback'
      ? 'Your callback request is saved.'
      : `Thanks for talking with ${personaName}.`;
  const transcriptText = transcript.map((l) => `${l.role === 'agent' ? personaName : guardianName}: ${l.text}`).join('\n');
  const toolSteps = snapshot?.toolCalls ?? [];
  // Step times are offsets from the call row's startedAt, written by the agent on the same clock as the tool log.
  const callStart = data?.call.startedAt ?? null;
  const memory = data ? memoryOutcome(data, personaName) : null;
  const closed = Boolean(data?.call.endedAt) || tries >= 10;

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader>
        <span className="flex items-center gap-2 text-sm text-text-muted">
          <span className="dot" />
          Call ended <span className="mono text-[14px]">{formatClock(seconds)}</span>
        </span>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 gap-5 px-10 py-8">
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="card flex flex-col gap-6 p-7">
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <span className={`dot ${booking ? 'dot-on' : snapshot?.outcome === 'callback' ? 'dot-warning' : ''}`} />
                {booking ? 'Booked' : snapshot?.outcome === 'callback' ? 'Callback' : 'No booking'}
              </span>
              <h1 className="font-display m-0 text-[40px] leading-[1.05] font-bold tracking-[-0.02em]">{headline}</h1>
              {!booking && snapshot?.outcome === 'callback' && (
                <span className="caption">
                  This is a demo: the request is stored and shown in the academy console, and no one will actually call you.
                </span>
              )}
              {booking && (
                <span className="caption">
                  Confirmation <span className="mono text-text">BK-{shortId(booking.id)}</span>. Saved while you were on the call.
                </span>
              )}
            </div>
            {booking && (
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-divider pt-5 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="caption">Child</dt>
                  <dd className="m-0">
                    {booking.childName}, age {booking.childAge}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="caption">Program</dt>
                  <dd className="m-0">{booking.programName}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="caption">Time</dt>
                  <dd className="m-0">{clockTime(booking.startsAt)}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="caption">Where</dt>
                  <dd className="m-0">{booking.location}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="caption">Coach</dt>
                  <dd className="m-0">{booking.coach}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="caption">Guardian</dt>
                  <dd className="m-0">{booking.guardianName ?? guardianName}</dd>
                </div>
              </dl>
            )}
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-primary" onClick={onRestart}>
                Start another call
              </button>
              <a
                className="btn-secondary"
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(transcriptText)}`}
                download={`bysa-call-${callId ?? 'transcript'}.txt`}
              >
                Download transcript
              </a>
            </div>
          </div>

          <div className="card flex flex-col gap-2 p-6">
            <h2 className="font-display m-0 text-[15px] font-semibold">What {personaName} will remember</h2>
            {data?.call.summary ? (
              <p className="m-0 text-[15px] leading-[1.6] text-text-secondary">{data.call.summary}</p>
            ) : (
              <p className="caption m-0 text-[14px]">{!callId ? 'No call record was created.' : closed ? 'No summary was saved for this call.' : 'Writing the summary now.'}</p>
            )}
            {memory?.note && <span className="caption">{memory.note}</span>}
          </div>
        </section>

        <aside className="card flex w-[360px] flex-none flex-col self-start">
          <h2 className="font-display m-0 border-b border-border px-5 py-4 text-[15px] font-semibold">This call, step by step</h2>
          <ol className="m-0 flex list-none flex-col gap-3 px-5 py-4">
            {/* No timestamp is recorded for identification (it happens before the call row opens), so the time cell stays blank. */}
            <Step time="" label="Caller identified">
              {snapshot ? (
                <>
                  <span className="mono text-[13px] whitespace-nowrap">{snapshot.identitySource}</span>
                  {snapshot.family.bound ? `, ${snapshot.family.isDemo ? 'demo family matched' : 'new family record'}` : ', no family record'}
                </>
              ) : (
                'no agent state received'
              )}
            </Step>
            {toolSteps.map((t, i) => {
              const step = describeTool(t);
              const at = offsetSeconds(t.at, callStart, seconds);
              return (
                <Step key={`${t.at}-${i}`} time={at === null ? '' : formatClock(at)} label={step.label}>
                  <span className="mono text-[13px] whitespace-nowrap">{t.name}</span>
                  {step.parts.map((part, j) => (
                    <span key={j}>
                      {', '}
                      <span className="whitespace-nowrap">{part}</span>
                    </span>
                  ))}
                </Step>
              );
            })}
            <Step time={formatClock(seconds)} label={data?.call.summary ? 'Summary saved' : 'Call ended'}>
              {data?.call.summary ? (
                memory?.familyUpdated ? (
                  <>
                    <span className="mono text-[13px]">family.summary</span> updated
                  </>
                ) : (
                  'on the call record only'
                )
              ) : !callId ? (
                ''
              ) : closed ? (
                'no summary written'
              ) : (
                'summary pending'
              )}
            </Step>
          </ol>
        </aside>
      </main>
      <footer className="border-t border-border px-10 py-4 text-xs text-text-muted">Prototype on LiveKit Agents. Fictional academy, programs, coaches and families.</footer>
    </div>
  );
}

function Step({ time, label, children }: { time: string; label: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mono w-11 flex-none pt-0.5 text-text-muted">{time}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-medium">{label}</span>
        {children ? <span className="text-[13px] leading-[1.45] text-text-muted">{children}</span> : null}
      </div>
    </li>
  );
}
