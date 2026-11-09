// Pushes a small "under the hood" snapshot to the browser over a LiveKit text stream (topic
// `movo.state`). Every field has a real source in the session context; nothing is sampled or
// typed in. The browser (web/) renders whatever is present and leaves the rest out.
import type { SessionContext } from './context.ts';

export const STATE_TOPIC = 'movo.state';

export interface TurnLatency {
  e2eMs: number | null;
  endOfTurnMs: number | null;
  llmTtftMs: number | null;
  ttsTtfbMs: number | null;
}

export interface StateSnapshot {
  v: 1;
  callId: string | null;
  roomName: string;
  identitySource: 'caller_id_only' | 'self_reported';
  family: { bound: boolean; label: string | null; isDemo: boolean | null; hasHistory: boolean };
  pipeline: { stt: string; llm: string; tts: string; provider?: 'inference' | 'direct' };
  proposal: { state: string; summary: string | null; clearedBecause: string | null; readbackText: string | null } | null;
  toolCalls: { name: string; ok: boolean; summary: string; durationMs: number | null; at: string }[];
  lastTurn: TurnLatency | null;
  interruptions: number;
  bookingIds: string[];
  outcome: string;
  ended: boolean;
}

export interface StateSink {
  send(text: string): Promise<void>;
}

export class StateChannel {
  private sink: StateSink | null = null;
  private pipeline: StateSnapshot['pipeline'];
  lastTurn: TurnLatency | null = null;
  interruptions = 0;
  ended = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(pipeline: StateSnapshot['pipeline']) {
    this.pipeline = pipeline;
  }

  attach(sink: StateSink): void {
    this.sink = sink;
  }

  snapshot(sc: SessionContext): StateSnapshot {
    const p = sc.proposals.current;
    return {
      v: 1,
      callId: sc.callId,
      roomName: sc.roomName,
      identitySource: sc.identity.source,
      family: {
        bound: Boolean(sc.familyId),
        label: sc.family?.guardianName ?? sc.identity.guardianName ?? null,
        isDemo: sc.family ? sc.family.isDemo : null,
        hasHistory: sc.familyHasHistory,
      },
      pipeline: this.pipeline,
      proposal: p
        ? {
            state: p.state,
            summary: `${p.childName} · ${p.programId} · ${p.slotId}`,
            clearedBecause: p.clearedBecause,
            readbackText: p.readbackText,
          }
        : null,
      toolCalls: sc.toolLog.map((t) => ({ name: t.name, ok: t.ok, summary: t.summary, durationMs: t.durationMs, at: t.at.toISOString() })),
      lastTurn: this.lastTurn,
      interruptions: this.interruptions,
      bookingIds: [...sc.bookingIds],
      outcome: sc.outcome,
      ended: this.ended,
    };
  }

  /** Serializes sends so snapshots arrive in order; failures are swallowed (the UI is best effort). */
  push(sc: SessionContext): void {
    const sink = this.sink;
    if (!sink) return;
    const text = JSON.stringify(this.snapshot(sc));
    this.queue = this.queue.then(() => sink.send(text)).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.queue;
  }
}
