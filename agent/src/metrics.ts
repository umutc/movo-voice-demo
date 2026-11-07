// Per-turn latency capture (PRD FR-10). Primary source: ChatMessage.metrics on assistant
// messages (seconds). Fallback: the latest per-plugin MetricsCollected values (milliseconds).
// Nothing is estimated; a missing value stays null.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AgentSession, AgentSessionEventTypes } from '@livekit/agents';
import type { SessionContext } from './context.ts';
import type { CallMetricsFile, TurnMetrics } from './metrics-types.ts';
import type { StateChannel } from './state-channel.ts';

const METRICS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../metrics');

export interface MetricsRecorder {
  readonly turns: TurnMetrics[];
  readonly interruptions: number;
  snapshot(): CallMetricsFile;
  flush(endedAt: Date): Promise<string | null>;
}

const secToMs = (s: number | undefined): number | null => (typeof s === 'number' && Number.isFinite(s) ? Math.round(s * 1000) : null);
const msOrNull = (v: number | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

interface PluginLatest {
  llmTtftMs: number | null;
  ttsTtfbMs: number | null;
  endOfTurnMs: number | null;
  transcriptionDelayMs: number | null;
}

export function attachMetrics(
  session: AgentSession<SessionContext>,
  sc: SessionContext,
  state: StateChannel,
  pipeline: CallMetricsFile['pipeline'],
): MetricsRecorder {
  const turns: TurnMetrics[] = [];
  const startedAt = sc.now().toISOString();
  let interruptions = 0;
  let usage: unknown = null;
  const latest: PluginLatest = { llmTtftMs: null, ttsTtfbMs: null, endOfTurnMs: null, transcriptionDelayMs: null };

  session.on(AgentSessionEventTypes.MetricsCollected, (ev) => {
    const m = ev.metrics;
    if (m.type === 'llm_metrics') latest.llmTtftMs = msOrNull(m.ttftMs);
    else if (m.type === 'tts_metrics') latest.ttsTtfbMs = msOrNull(m.ttfbMs);
    else if (m.type === 'eou_metrics') {
      latest.endOfTurnMs = msOrNull(m.endOfUtteranceDelayMs);
      latest.transcriptionDelayMs = msOrNull(m.transcriptionDelayMs);
    }
  });

  session.on(AgentSessionEventTypes.SessionUsageUpdated, (ev) => {
    usage = ev.usage;
  });

  session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    const item = ev.item;
    if (item.type !== 'message' || item.role !== 'assistant') return;
    const m = item.metrics ?? {};
    const turn: TurnMetrics = {
      turnId: item.id,
      at: sc.now().toISOString(),
      e2eMs: secToMs(m.e2eLatency),
      endOfTurnMs: secToMs(m.endOfTurnDelay) ?? latest.endOfTurnMs,
      transcriptionDelayMs: secToMs(m.transcriptionDelay) ?? latest.transcriptionDelayMs,
      llmTtftMs: secToMs(m.llmNodeTtft) ?? latest.llmTtftMs,
      ttsTtfbMs: secToMs(m.ttsNodeTtfb) ?? latest.ttsTtfbMs,
      interrupted: item.interrupted === true,
    };
    turns.push(turn);
    if (turn.interrupted) interruptions += 1;
    state.lastTurn = { e2eMs: turn.e2eMs, endOfTurnMs: turn.endOfTurnMs, llmTtftMs: turn.llmTtftMs, ttsTtfbMs: turn.ttsTtfbMs };
    state.interruptions = interruptions;
    state.push(sc);
  });

  let endedAtValue: string | null = null;
  const snapshot = (): CallMetricsFile => ({
    v: 1,
    callId: sc.callId,
    roomName: sc.roomName,
    identitySource: sc.identity.source,
    startedAt,
    endedAt: endedAtValue,
    pipeline,
    turns: [...turns],
    interruptions,
    usage: usage ?? safeUsage(session),
  });

  return {
    turns,
    get interruptions() {
      return interruptions;
    },
    snapshot,
    async flush(endedAt: Date) {
      endedAtValue = endedAt.toISOString();
      if (!sc.callId) return null;
      await mkdir(METRICS_DIR, { recursive: true });
      const file = path.join(METRICS_DIR, `${sc.callId}.json`);
      await writeFile(file, `${JSON.stringify(snapshot(), null, 2)}\n`);
      return file;
    },
  };
}

function safeUsage(session: AgentSession<SessionContext>): unknown {
  try {
    return session.usage;
  } catch {
    return null;
  }
}
