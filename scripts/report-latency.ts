// Prints p50/p95 per latency metric from metrics/*.json (PRD FR-10). Usage: report-latency.ts [dir]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallMetricsFile, TurnMetrics } from '../agent/src/metrics-types.ts';

export type MetricKey = 'e2eMs' | 'endOfTurnMs' | 'transcriptionDelayMs' | 'llmTtftMs' | 'ttsTtfbMs';
export const METRIC_KEYS: MetricKey[] = ['e2eMs', 'endOfTurnMs', 'transcriptionDelayMs', 'llmTtftMs', 'ttsTtfbMs'];

export interface MetricSummary {
  key: MetricKey;
  n: number;
  p50: number | null;
  p95: number | null;
}

export interface Summary {
  calls: number;
  turns: number;
  interruptions: number;
  metrics: MetricSummary[];
}

/** Nearest-rank percentile (p in 0..100) over unsorted values; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

export function summarize(files: CallMetricsFile[]): Summary {
  const turns: TurnMetrics[] = files.flatMap((f) => f.turns);
  const metrics = METRIC_KEYS.map((key) => {
    const vals = turns.map((t) => t[key]).filter((v): v is number => typeof v === 'number');
    return { key, n: vals.length, p50: percentile(vals, 50), p95: percentile(vals, 95) };
  });
  return { calls: files.length, turns: turns.length, interruptions: files.reduce((s, f) => s + f.interruptions, 0), metrics };
}

export function renderTable(s: Summary, date: string): string {
  const cell = (v: number | null) => (v === null ? 'n/a' : String(v));
  const lines = [
    `Latency report, ${date}`,
    `Calls: ${s.calls}, assistant turns: ${s.turns}, interruptions: ${s.interruptions}`,
    '',
    '| Metric | p50 ms | p95 ms | n |',
    '|---|---|---|---|',
    ...s.metrics.map((m) => `| ${m.key} | ${cell(m.p50)} | ${cell(m.p95)} | ${m.n} |`),
  ];
  return lines.join('\n');
}

function main(): void {
  const dir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../metrics'));
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    names = [];
  }
  if (names.length === 0) {
    console.log('no metrics files yet; run a call first');
    return;
  }
  const files = names.map((n) => JSON.parse(readFileSync(path.join(dir, n), 'utf8')) as CallMetricsFile);
  console.log(renderTable(summarize(files), new Date().toISOString().slice(0, 10)));
}

if (process.env.VITEST === undefined) main();
