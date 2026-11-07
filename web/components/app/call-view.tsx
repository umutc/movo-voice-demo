'use client';

import { useEffect, useMemo, useState } from 'react';
import { Track } from 'livekit-client';
import { useAgent, useSessionContext, type UseSessionMessagesReturn, useTextStream, useTrackToggle } from '@livekit/components-react';
import { formatClock, MicIcon, Wordmark } from './site-header';
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
  const proposalSteps = ['pending', 'readback_spoken', 'confirmed', 'consumed'];
  const currentStep = snapshot?.proposal?.state ?? null;
  const toolCalls = snapshot?.toolCalls ?? [];

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-border bg-surface px-10 py-[18px]">
        <Wordmark />
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2 text-sm">
            <span className={`dot ${session.isConnected ? 'dot-on' : ''}`} />
            <span>{session.isConnected ? 'Connected' : 'Connecting'}</span>
            <span className="mono text-text-muted">{formatClock(seconds)}</span>
          </span>
          <button type="button" onClick={endCall} disabled={ending} className="btn-secondary text-danger" style={{ borderColor: '#B91C1C' }}>
            End call
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1200px] flex-1 gap-5 px-10 py-8">
        <section className="card flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-divider px-6 py-4">
            <div className="flex items-center gap-4">
              <div aria-hidden="true" className="flex items-end gap-[3px]" style={{ height: 22 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="block w-[4px] rounded-[2px]"
                    style={{
                      height: agentState === 'speaking' ? [10, 18, 22, 16, 9][i] : 6,
                      background: agentState === 'speaking' ? '#166534' : '#CBD5D0',
                      transition: 'height 200ms',
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-medium">{statusText}</span>
                <span className="caption">Say anything to interrupt.</span>
              </div>
            </div>
            <button
              type="button"
              aria-label={mic.enabled ? 'Mute microphone' : 'Unmute microphone'}
              onClick={() => void mic.toggle()}
              className="btn-secondary h-10 w-10 p-0"
              style={{ borderColor: mic.enabled ? '#CBD5D0' : '#B91C1C' }}
            >
              <MicIcon color={mic.enabled ? '#0F172A' : '#B91C1C'} />
            </button>
          </div>

          <div className="flex flex-col gap-4 px-6 py-5">
            {transcript.length === 0 && <p className="caption m-0">Waiting for {personaName} to say hello.</p>}
            {transcript.map((line) => {
              const isReadback = line.role === 'agent' && looksLikeReadback(readback, line.text);
              return (
                <div key={line.id} className="flex flex-col gap-1" style={isReadback ? { borderLeft: '3px solid #166534', paddingLeft: 12 } : undefined}>
                  <span className={`text-xs font-semibold ${line.role === 'agent' ? 'text-accent' : 'text-text-muted'}`}>
                    {line.role === 'agent' ? personaName : guardianName}
                  </span>
                  <p className="m-0 text-[15px] leading-[1.5]">{line.text}</p>
                </div>
              );
            })}
            <form
              className="flex gap-2 border-t border-divider pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft.trim();
                if (!text || isSending) return;
                setDraft('');
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
            {toolCalls.length > 0 && (
              <div className="mono flex flex-col gap-1 border-t border-divider pt-3 text-text-muted">
                {toolCalls.slice(-3).map((t, i) => (
                  <span key={`${t.at}-${i}`}>
                    {t.name} · {t.summary}
                    {t.durationMs !== null ? ` · ${t.durationMs} ms` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside aria-label="Under the hood" className="card flex w-[340px] flex-none flex-col gap-5 self-start p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display m-0 text-[15px] font-semibold">Under the hood</h2>
            <span className="mono text-text-muted">{snapshot?.roomName ?? session.room.name ?? ''}</span>
          </div>
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
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
            <dd className="mono m-0">
              {pipelineShown.stt.split('/').pop()} · {pipelineShown.llm.split('/').pop()} · {pipelineShown.tts.split('/').pop()?.split(':')[0]}
            </dd>
          </dl>

          <div className="flex flex-col gap-2 border-t border-divider pt-4">
            <span className="text-[13px] text-text-muted">Booking proposal</span>
            <div className="flex flex-wrap items-center gap-1 text-[12px]">
              {proposalSteps.map((step, i) => (
                <span key={step} className="flex items-center gap-1">
                  <span className={`dot ${currentStep === step ? 'dot-on' : currentStep === 'cleared' && step === 'pending' ? 'dot-warning' : ''}`} />
                  <span className={`mono ${currentStep === step ? 'text-text' : 'text-text-muted'}`}>{step === 'readback_spoken' ? 'read back' : step}</span>
                  {i < proposalSteps.length - 1 && <span className="text-text-muted">·</span>}
                </span>
              ))}
            </div>
            <p className="caption m-0">
              {snapshot?.proposal
                ? `${snapshot.proposal.summary ?? ''}${
                    snapshot.proposal.state === 'cleared' && snapshot.proposal.clearedBecause
                      ? `. Cleared: ${snapshot.proposal.clearedBecause}.`
                      : snapshot.proposal.state === 'confirmed'
                        ? '. The yes came right after the read-back, so booking may run.'
                        : ''
                  }`
                : 'No proposal yet.'}
            </p>
          </div>

          {snapshot?.lastTurn && (
            <div className="flex flex-col gap-2 border-t border-divider pt-4">
              <span className="text-[13px] text-text-muted">Last turn</span>
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 text-[13px]">
                {snapshot.lastTurn.e2eMs !== null && (
                  <>
                    <dt>End to end</dt>
                    <dd className="mono m-0">{snapshot.lastTurn.e2eMs} ms</dd>
                  </>
                )}
                {snapshot.lastTurn.endOfTurnMs !== null && (
                  <>
                    <dt>End of utterance</dt>
                    <dd className="mono m-0">{snapshot.lastTurn.endOfTurnMs} ms</dd>
                  </>
                )}
                {snapshot.lastTurn.llmTtftMs !== null && (
                  <>
                    <dt>LLM first token</dt>
                    <dd className="mono m-0">{snapshot.lastTurn.llmTtftMs} ms</dd>
                  </>
                )}
                {snapshot.lastTurn.ttsTtfbMs !== null && (
                  <>
                    <dt>TTS first byte</dt>
                    <dd className="mono m-0">{snapshot.lastTurn.ttsTtfbMs} ms</dd>
                  </>
                )}
                <dt>Interruptions</dt>
                <dd className="mono m-0">{snapshot.interruptions}</dd>
              </dl>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-divider pt-4">
            <span className="text-[13px] text-text-muted">Tool calls</span>
            {toolCalls.length === 0 ? (
              <span className="caption">None yet.</span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {toolCalls.map((t, i) => (
                  <li key={`${t.at}-${i}`} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="mono flex items-center gap-2">
                      <span className={`dot ${t.ok ? 'dot-on' : 'dot-danger'}`} />
                      {t.name}
                    </span>
                    <span className="mono text-text-muted">{t.durationMs !== null ? `${t.durationMs} ms` : t.ok ? 'ok' : 'error'}</span>
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
