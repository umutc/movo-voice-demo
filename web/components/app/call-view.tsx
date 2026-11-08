'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { useAgent, useSessionContext, type UseSessionMessagesReturn, useTextStream, useTrackToggle } from '@livekit/components-react';
import { attachToolsToTurns, proposalSummaryParts, toolDetail } from '@/lib/call-format';
import { formatClock, HEADER_HEIGHT, MicIcon, SiteHeader } from './site-header';
import type { Pipeline, StateSnapshot, TranscriptLine } from './types';

interface Props {
  personaName: string;
  guardianName: string;
  pipeline: Pipeline;
  messagesApi: UseSessionMessagesReturn;
  onEnded: (final: { snapshot: StateSnapshot | null; transcript: TranscriptLine[]; seconds: number }) => void;
}

export const STATE_TOPIC = 'movo.state';

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Same token-overlap rule as the agent's read-back detector, so the highlighted turn is the one the worker accepted. */
export function looksLikeReadback(readback: string | null | undefined, text: string): boolean {
  if (!readback) return false;
  const want = normalize(readback);
  if (want.length === 0) return false;
  const have = new Map<string, number>();
  for (const t of normalize(text)) have.set(t, (have.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of want) {
    const n = have.get(t) ?? 0;
    if (n > 0) {
      hit += 1;
      have.set(t, n - 1);
    }
  }
  return hit / want.length >= 0.8;
}

export function useStateSnapshot(): StateSnapshot | null {
  const { textStreams } = useTextStream(STATE_TOPIC);
  return useMemo(() => {
    const last = textStreams[textStreams.length - 1];
    if (!last) return null;
    try {
      return JSON.parse(last.text) as StateSnapshot;
    } catch {
      return null;
    }
  }, [textStreams]);
}

export function CallView({ personaName, guardianName, pipeline, messagesApi, onEnded }: Props) {
  const session = useSessionContext();
  const agent = useAgent();
  const { messages, send, isSending } = messagesApi;
  const [draft, setDraft] = useState('');
  const snapshot = useStateSnapshot();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const [seconds, setSeconds] = useState(0);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const transcript: TranscriptLine[] = useMemo(
    () =>
      messages
        .filter((m) => 'message' in m && typeof m.message === 'string' && m.message.trim())
        .map((m) => ({
          id: m.id,
          role: m.type === 'agentTranscript' || (m.from && m.from.isAgent) ? 'agent' : 'user',
          text: (m as { message: string }).message,
          at: m.timestamp,
        })),
    [messages],
  );

  const endCall = async () => {
    setEnding(true);
    try {
      await session.end();
    } finally {
      onEnded({ snapshot, transcript, seconds });
    }
  };

  // The agent ends the call itself after end_call (room deleted, or `ended` in the last snapshot).
  const agentGone = (!session.isConnected && seconds > 2) || snapshot?.ended === true;
  useEffect(() => {
    if (agentGone && !ending) {
      setEnding(true);
      void session.end().finally(() => onEnded({ snapshot, transcript, seconds }));
    }
  }, [agentGone]);

  const agentState = agent.state;
  const statusText =
    agentState === 'speaking'
      ? `${personaName} is speaking`
      : agentState === 'thinking'
        ? `${personaName} is thinking`
        : agentState === 'listening'
          ? `${personaName} is listening`
          : agent.isConnected
            ? 'Connected'
            : `Waiting for ${personaName}`;
  const readback = snapshot?.proposal?.readbackText ?? null;
  const pipelineShown = snapshot?.pipeline ?? pipeline;
  const proposal = snapshot?.proposal ?? null;
  const toolCalls = useMemo(() => snapshot?.toolCalls ?? [], [snapshot]);
  const toolsByTurn = useMemo(
    () =>
      attachToolsToTurns(
        transcript,
        toolCalls.map((t) => new Date(t.at).getTime()),
      ),
    [transcript, toolCalls],
  );
  const guardianShort = guardianName.trim().split(/\s+/)[0] || guardianName;

  // Keep the newest turn in view unless the caller scrolled up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript, toolCalls]);

  const toolLine = (ti: number) => {
    const t = toolCalls[ti]!;
    return (
      <div key={`tool-${t.at}-${ti}`} className="mono flex gap-[14px] text-text-muted">
        <span className="flex-[0_0_48px]" />
        <span className="flex min-w-0 flex-wrap gap-x-1">
          {[t.name, ...toolDetail(t), ...(t.durationMs !== null ? [`${t.durationMs} ms`] : [])].map((part, i) => (
            <span key={i} className="whitespace-nowrap">
              {i > 0 ? '· ' : ''}
              {part}
            </span>
          ))}
        </span>
      </div>
    );
  };

  // Card height: the viewport minus the header and main padding; the transcript scrolls inside it.
  const cardMaxHeight = `calc(100svh - ${HEADER_HEIGHT}px - 56px)`;

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <SiteHeader>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2 text-sm">
            <span className={`dot ${session.isConnected ? 'dot-on' : ''}`} />
            <span>{session.isConnected ? 'Connected' : 'Connecting'}</span>
            <span className="mono text-[14px] text-text-muted">{formatClock(seconds)}</span>
          </span>
          <button type="button" onClick={endCall} disabled={ending} className="btn-secondary border-danger font-semibold text-danger hover:border-danger">
            End call
          </button>
        </div>
      </SiteHeader>

      <main className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 items-start gap-6 px-10 py-7">
        <section className="card flex min-w-0 flex-1 flex-col" style={{ maxHeight: cardMaxHeight }}>
          <div className="flex flex-none items-center gap-4 border-b border-border px-6 py-4">
            <div aria-hidden="true" className="flex items-end gap-[3px]" style={{ height: 22 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="block w-[4px] rounded-[2px]"
                  style={{
                    height: agentState === 'speaking' ? [8, 16, 22, 12, 6][i] : 6,
                    background: agentState === 'speaking' ? '#166534' : '#CBD5D0',
                    transition: 'height 200ms',
                  }}
                />
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{statusText}</span>
              <span className="text-[13px] text-text-muted">Say anything to interrupt.</span>
            </div>
            <button
              type="button"
              aria-label={mic.enabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={!mic.enabled}
              onClick={() => void mic.toggle()}
              className={`btn-secondary ml-auto h-11 w-11 p-0 ${mic.enabled ? '' : 'border-danger hover:border-danger'}`}
            >
              <MicIcon size={20} color={mic.enabled ? '#0F172A' : '#B91C1C'} muted={!mic.enabled} />
            </button>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
            className="flex min-h-[160px] flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-6"
            aria-live="polite"
          >
            {transcript.length === 0 && <p className="m-0 text-[14px] text-text-muted">Waiting for {personaName} to say hello.</p>}
            {(toolsByTurn.get(-1) ?? []).map(toolLine)}
            {transcript.map((line, idx) => {
              const isReadback = line.role === 'agent' && looksLikeReadback(readback, line.text);
              const sameSpeaker = idx > 0 && transcript[idx - 1]!.role === line.role;
              const speaker = line.role === 'agent' ? personaName : guardianShort;
              return (
                <Fragment key={line.id}>
                  <div className={`flex gap-[14px] ${sameSpeaker ? '-mt-2' : ''}`}>
                    <span
                      className={`flex-[0_0_48px] truncate pt-[3px] text-xs font-semibold ${line.role === 'agent' ? 'text-accent-strong' : 'text-text-muted'}`}
                      title={sameSpeaker ? undefined : speaker}
                    >
                      {sameSpeaker ? '' : speaker}
                    </span>
                    <p
                      className={`m-0 min-w-0 max-w-[62ch] text-[16px] leading-[1.55] ${line.role === 'user' ? 'text-text-secondary' : ''} ${
                        isReadback ? 'rounded-r-[8px] border-l-[3px] border-accent bg-background px-4 py-3' : ''
                      }`}
                    >
                      {line.text}
                    </p>
                  </div>
                  {(toolsByTurn.get(idx) ?? []).map(toolLine)}
                </Fragment>
              );
            })}
          </div>

          <form
            className="flex flex-none gap-2 border-t border-border px-6 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text || isSending) return;
              setDraft('');
              stickToBottom.current = true;
              void send(text);
            }}
          >
            <input
              aria-label="Type a message"
              className="input h-10"
              placeholder="Or type instead of talking"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn-secondary h-10" disabled={!draft.trim() || isSending}>
              Send
            </button>
          </form>
        </section>

        <aside aria-label="Under the hood" className="card flex w-[360px] flex-none flex-col overflow-y-auto" style={{ maxHeight: cardMaxHeight }}>
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="font-display m-0 text-[15px] font-semibold whitespace-nowrap">Under the hood</h2>
            <span className="mono truncate text-text-muted">{snapshot?.roomName ?? session.room.name ?? ''}</span>
          </div>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-border px-5 py-4 text-[13px]">
            <dt className="text-text-muted">Identity</dt>
            <dd className="mono m-0">{snapshot?.identitySource ?? 'self_reported'}</dd>
            <dt className="text-text-muted">Family</dt>
            <dd className="m-0">
              {snapshot
                ? snapshot.family.bound
                  ? `${snapshot.family.label ?? 'family'}, ${snapshot.family.isDemo ? 'demo record' : 'new record'}${snapshot.family.hasHistory ? ', with history' : ''}`
                  : 'not bound yet'
                : 'waiting for agent'}
            </dd>
            <dt className="text-text-muted">Pipeline</dt>
            <dd className="mono m-0 flex flex-wrap gap-x-1">
              {[pipelineShown.stt.split('/').pop(), pipelineShown.llm.split('/').pop(), pipelineShown.tts.split('/').pop()?.split(':')[0]].map((m, i) => (
                <span key={i} className="whitespace-nowrap">
                  {i > 0 ? '· ' : ''}
                  {m}
                </span>
              ))}
            </dd>
          </dl>

          <ProposalBlock proposal={proposal} />

          {snapshot?.lastTurn && (
            <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
              <span className="text-xs font-semibold tracking-[0.06em] text-text-muted uppercase">Last turn</span>
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px]">
                {(
                  [
                    ['End to end', snapshot.lastTurn.e2eMs],
                    ['End of utterance', snapshot.lastTurn.endOfTurnMs],
                    ['LLM first token', snapshot.lastTurn.llmTtftMs],
                    ['TTS first byte', snapshot.lastTurn.ttsTtfbMs],
                  ] as const
                )
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="text-text-muted">{k}</dt>
                      <dd className="mono m-0 text-right text-[13px] whitespace-nowrap">{v} ms</dd>
                    </Fragment>
                  ))}
                <dt className="text-text-muted">Interruptions</dt>
                <dd className="mono m-0 text-right text-[13px]">{snapshot.interruptions}</dd>
              </dl>
            </div>
          )}

          <div className="flex flex-col gap-2 px-5 py-4">
            <span className="text-xs font-semibold tracking-[0.06em] text-text-muted uppercase">Tool calls</span>
            {toolCalls.length === 0 ? (
              <span className="text-[13px] text-text-muted">None yet.</span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {toolCalls.map((t, i) => (
                  <li key={`${t.at}-${i}`} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="mono flex items-center gap-2 text-[13px]">
                      <span className={`dot ${t.ok ? 'dot-on' : 'dot-danger'}`} />
                      {t.name}
                    </span>
                    <span className="mono text-[13px] whitespace-nowrap text-text-muted">{t.durationMs !== null ? `${t.durationMs} ms` : t.ok ? 'ok' : 'error'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

const PROPOSAL_STEPS = [
  ['pending', 'pending'],
  ['readback_spoken', 'read back'],
  ['confirmed', 'confirmed'],
  ['consumed', 'consumed'],
] as const;

/** Booking proposal state: status as dot plus text, the step path, the slot, and the clear reason on its own line. */
function ProposalBlock({ proposal }: { proposal: StateSnapshot['proposal'] }) {
  const state = proposal?.state ?? null;
  const cleared = state === 'cleared';
  const statusLabel = !proposal
    ? 'No proposal yet'
    : cleared
      ? 'Cleared, nothing will be booked'
      : state === 'readback_spoken'
        ? 'Read back, waiting for a yes'
        : state === 'confirmed'
          ? 'Confirmed'
          : state === 'consumed'
            ? 'Booked'
            : 'Pending';
  const parts = proposalSummaryParts(proposal?.summary ?? null);
  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
      <span className="text-xs font-semibold tracking-[0.06em] text-text-muted uppercase">Booking proposal</span>
      <span className="flex items-center gap-2 text-[13px] font-medium">
        <span className={`dot ${!proposal ? '' : cleared ? 'dot-warning' : 'dot-on'}`} />
        {statusLabel}
      </span>
      {proposal && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]" aria-label="Proposal steps">
          {PROPOSAL_STEPS.map(([key, label], i) => (
            <span key={key} className="flex items-center gap-1.5 whitespace-nowrap">
              {i > 0 && <span className="text-control-border">→</span>}
              <span className={state === key ? 'font-semibold text-accent-strong' : cleared ? 'text-off' : 'text-text-muted'}>{label}</span>
            </span>
          ))}
        </div>
      )}
      {parts.length > 0 && (
        <p className="m-0 flex flex-wrap gap-x-1 text-[13px] leading-[1.5] text-text-secondary">
          {parts.map((p, i) => (
            <span key={i} className="whitespace-nowrap">
              {i > 0 ? '· ' : ''}
              {p}
            </span>
          ))}
        </p>
      )}
      {cleared && proposal?.clearedBecause && (
        <p className="m-0 text-[13px] leading-[1.5] text-text-secondary">Reason: {proposal.clearedBecause.replace(/\.$/, '')}.</p>
      )}
      {state === 'confirmed' && <p className="m-0 text-[13px] leading-[1.5] text-text-secondary">The yes came right after the read-back, so booking may run.</p>}
    </div>
  );
}
