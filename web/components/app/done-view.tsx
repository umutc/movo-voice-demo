'use client';

import { useEffect, useState } from 'react';
import { formatClock, Wordmark } from './site-header';
import type { StateSnapshot, TranscriptLine } from './types';

interface CallViewData {
  call: { id: string; identitySource: string; startedAt: string; endedAt: string | null; outcome: string | null; summary: string | null };
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

const NY = 'America/New_York';

function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
}
function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function DoneView({ personaName, guardianName, snapshot, transcript, seconds, onRestart }: Props) {
  const callId = snapshot?.callId ?? null;
  const [data, setData] = useState<CallViewData | null>(null);
  const [tries, setTries] = useState(0);

  // The summary is written a few seconds after hangup; poll the call row until it shows up.
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
        if (!json.call.summary && tries < 10) setTimeout(() => setTries((t) => t + 1), 2500);
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
      ? 'The academy staff will call you back.'
      : 'Thanks for talking with Maya.';
  const transcriptText = transcript.map((l) => `${l.role === 'agent' ? personaName : guardianName}: ${l.text}`).join('\n');
  const toolSteps = snapshot?.toolCalls ?? [];
  const startedAt = toolSteps[0] ? new Date(toolSteps[0].at).getTime() - 1000 : null;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-border bg-surface px-10 py-[18px]">
        <Wordmark />
        <span className="flex items-center gap-2 text-sm">
          <span className="dot" />
          Call ended <span className="mono text-text-muted">{formatClock(seconds)}</span>
        </span>
      </header>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 gap-5 px-10 py-8">
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="card flex flex-col gap-6 p-7">
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <span className={`dot ${booking ? 'dot-on' : snapshot?.outcome === 'callback' ? 'dot-warning' : ''}`} />
                {booking ? 'Booked' : snapshot?.outcome === 'callback' ? 'Callback' : 'No booking'}
              </span>
              <h1 className="font-display m-0 text-[40px] leading-[1.05] font-bold tracking-[-0.02em]">{headline}</h1>
              {booking && (
                <span className="caption">
                  Confirmation <span className="mono text-text">BK-{booking.id.slice(0, 8).toUpperCase()}</span>. Saved while you were on the call.
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
              <p className="m-0 text-[15px] leading-[1.55]">{data.call.summary}</p>
            ) : (
              <p className="caption m-0">{callId ? 'Writing the summary now.' : 'No call record was created.'}</p>
            )}
            <span className="caption">Stored on the family record and read back to {personaName} at the start of the next call.</span>
          </div>
        </section>

        <aside className="card flex w-[340px] flex-none flex-col gap-5 self-start p-6">
          <h2 className="font-display m-0 text-[15px] font-semibold">This call, step by step</h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            <li className="flex gap-3 text-[13px]">
              <span className="mono w-11 flex-none text-text-muted">00:00</span>
              <div className="flex flex-col">
                <span className="font-medium">Caller identified</span>
                <span className="caption">
                  {snapshot ? `${snapshot.identitySource}${snapshot.family.bound ? `, ${snapshot.family.isDemo ? 'demo family matched' : 'family record created'}` : ''}` : 'no agent state received'}
                </span>
              </div>
            </li>
            {toolSteps.map((t, i) => (
              <li key={`${t.at}-${i}`} className="flex gap-3 text-[13px]">
                <span className="mono w-11 flex-none text-text-muted">
                  {startedAt ? formatClock(Math.max(0, Math.round((new Date(t.at).getTime() - startedAt) / 1000))) : ''}
                </span>
                <div className="flex flex-col">
                  <span className="font-medium">{t.name.replace(/_/g, ' ')}</span>
                  <span className="caption">
                    {t.summary}
                    {t.durationMs !== null ? ` · ${t.durationMs} ms` : ''}
                  </span>
                </div>
              </li>
            ))}
            <li className="flex gap-3 text-[13px]">
              <span className="mono w-11 flex-none text-text-muted">{formatClock(seconds)}</span>
              <div className="flex flex-col">
                <span className="font-medium">{data?.call.summary ? 'Summary saved' : 'Call ended'}</span>
                <span className="caption">{data?.call.summary ? 'family.summary updated' : callId ? 'summary pending' : ''}</span>
              </div>
            </li>
          </ol>
        </aside>
      </main>
      <footer className="border-t border-border px-10 py-4 text-xs text-text-muted">Prototype on LiveKit Agents. Fictional academy, programs, coaches and families.</footer>
    </div>
  );
}
