import { describe, expect, it } from 'vitest';
import type { CallMetricsFile, TurnMetrics } from '../agent/src/metrics-types.ts';
import { percentile, renderTable, summarize } from './report-latency.ts';

const turn = (o: Partial<TurnMetrics>): TurnMetrics => ({
  turnId: 't', at: '2026-11-07T00:00:00Z', e2eMs: null, endOfTurnMs: null, transcriptionDelayMs: null,
  llmTtftMs: null, ttsTtfbMs: null, interrupted: false, ...o,
});
const file = (turns: TurnMetrics[], interruptions = 0): CallMetricsFile => ({
  v: 1, callId: 'c', roomName: 'r', identitySource: 'self_reported', startedAt: 'a', endedAt: null,
  pipeline: { stt: 's', llm: 'l', tts: 't' }, turns, interruptions, usage: null,
});

describe('percentile', () => {
  it('uses nearest rank on sorted values', () => {
    const v = [50, 10, 40, 20, 30];
    expect(percentile(v, 50)).toBe(30);
    expect(percentile(v, 95)).toBe(50);
    expect(percentile(v, 0)).toBe(10);
  });
  it('returns null for empty input', () => expect(percentile([], 50)).toBeNull());
});

describe('summarize', () => {
  it('skips nulls and counts n per metric', () => {
    const s = summarize([file([turn({ e2eMs: 100, llmTtftMs: 10 }), turn({ e2eMs: 300 })], 1), file([turn({ e2eMs: 200 })], 2)]);
    expect(s.calls).toBe(2);
    expect(s.turns).toBe(3);
    expect(s.interruptions).toBe(3);
    const e2e = s.metrics.find((m) => m.key === 'e2eMs');
    expect(e2e).toMatchObject({ n: 3, p50: 200, p95: 300 });
    expect(s.metrics.find((m) => m.key === 'llmTtftMs')?.n).toBe(1);
    expect(s.metrics.find((m) => m.key === 'ttsTtfbMs')).toMatchObject({ n: 0, p50: null });
  });
});

describe('renderTable', () => {
  it('renders markdown with n/a for empty metrics', () => {
    const out = renderTable(summarize([file([turn({ e2eMs: 120 })])]), '2026-11-07');
    expect(out).toContain('2026-11-07');
    expect(out).toContain('| e2eMs | 120 | 120 | 1 |');
    expect(out).toContain('| ttsTtfbMs | n/a | n/a | 0 |');
  });
});
