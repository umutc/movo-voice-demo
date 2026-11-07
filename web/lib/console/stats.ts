import type { CallMetricsJson } from 'db/read';

// Same nearest-rank math as scripts/report-latency.ts (that file runs its CLI on import, so the
// function is repeated here rather than imported).
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

export type MetricKey = 'e2eMs' | 'endOfTurnMs' | 'transcriptionDelayMs' | 'llmTtftMs' | 'ttsTtfbMs';

export const METRIC_LABELS: { key: MetricKey; label: string }[] = [
  { key: 'e2eMs', label: 'End to end' },
  { key: 'endOfTurnMs', label: 'End of utterance' },
  { key: 'transcriptionDelayMs', label: 'Transcription delay' },
  { key: 'llmTtftMs', label: 'LLM first token' },
  { key: 'ttsTtfbMs', label: 'TTS first byte' },
];

export interface MetricSummary {
  key: MetricKey;
  label: string;
  n: number;
  p50: number | null;
  p95: number | null;
}

export function summarizeMetrics(list: (CallMetricsJson | null)[]): { turns: number; interruptions: number; metrics: MetricSummary[] } {
  const turns = list.flatMap((m) => m?.turns ?? []);
  const metrics = METRIC_LABELS.map(({ key, label }) => {
    const vals = turns.map((t) => t[key]).filter((v): v is number => typeof v === 'number');
    return { key, label, n: vals.length, p50: percentile(vals, 50), p95: percentile(vals, 95) };
  });
  const interruptions = list.reduce((s, m) => s + (typeof m?.interruptions === 'number' ? m.interruptions : 0), 0);
  return { turns: turns.length, interruptions, metrics };
}
