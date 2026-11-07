// Copies the per-call metrics the worker stored in calls.metrics (same shape as metrics/<callId>.json)
// into metrics/, so calls handled by the LiveKit Cloud deployment also feed pnpm report:latency.
// Usage: pnpm metrics:export   (needs DATABASE_URL)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'metrics');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1, ssl: 'require', prepare: false });
  try {
    const rows = await sql<{ id: string; metrics: unknown }[]>`select id, metrics from calls where metrics is not null`;
    mkdirSync(outDir, { recursive: true });
    let written = 0;
    for (const row of rows) {
      const m = row.metrics as { v?: number; turns?: unknown[] } | null;
      if (!m || m.v !== 1 || !Array.isArray(m.turns)) continue;
      const file = join(outDir, `${row.id}.json`);
      if (existsSync(file)) continue;
      writeFileSync(file, JSON.stringify(m, null, 2));
      written += 1;
    }
    console.log(`exported ${written} new metrics file(s) from ${rows.length} call(s) with metrics`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.env.VITEST === undefined) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
