// Sends one alert of kind `test` through the same path the agent and the web use (SNS, alerts
// table dedupe). Prints the outcome only, never the topic credentials.
//   pnpm alerts:test
import { Alerter, alertPortFromEnv, parseAlertsEnv } from '../db/alerts.ts';
import { openOps } from '../db/ops.ts';

async function main(): Promise<void> {
  const cfg = parseAlertsEnv(process.env);
  if (!cfg.sns) throw new Error(`alerts are off: ${cfg.off ?? 'unknown reason'}`);
  const { ops, close } = openOps(process.env.DATABASE_URL);
  try {
    const outcome = await new Alerter({ port: alertPortFromEnv(cfg), log: ops, cooldownMs: cfg.cooldownMs, publishTimeoutMs: 10_000 }).send('test', {
      detail: 'manual test',
    });
    console.log(`test alert: ${outcome}`);
    if (outcome === 'failed') process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
