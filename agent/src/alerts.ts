// Agent side of the alerts and the automatic pause. The real SNS port is wired only when ALERTS_*
// is set (db/alerts.ts); otherwise a no-op logs once. Nothing here throws into a call.
import { Alerter, type AlertLog, alertPortFromEnv, type AlertPort, parseAlertsEnv } from 'db/alerts';
import type { AlertLogPort, DemoStatePort } from 'db/ops';
import { classifyProviderError, type ProviderErrorClass } from './provider-errors.ts';

export interface PinoLike {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export function alertLogFor(logger: PinoLike): AlertLog {
  return (level, msg, fields) => logger[level](fields ?? {}, msg);
}

// One port per worker process, so the no-op logs once per process, not once per call.
let sharedPort: AlertPort | null = null;

/** The job's Alerter: dedupe through the alerts table on the job's database connection. */
export function agentAlerter(log: AlertLogPort | null, logger: PinoLike, env: Record<string, string | undefined> = process.env, port?: AlertPort): Alerter {
  const cfg = parseAlertsEnv(env);
  const alertLog = alertLogFor(logger);
  sharedPort ??= alertPortFromEnv(cfg, alertLog);
  return new Alerter({ port: port ?? sharedPort, log, cooldownMs: cfg.cooldownMs, logger: alertLog });
}

/** The `error` event payload STT, LLM and TTS emit (STTError, LLMError, TTSError in @livekit/agents). */
export interface ModelErrorEvent {
  error?: unknown;
  recoverable?: boolean;
  label?: string;
}

export interface ErrorEmitter {
  on(event: 'error', listener: (ev: ModelErrorEvent) => void): unknown;
}

/**
 * Listens to the `error` event of each model and calls `onTrip` once, on the first credit, quota
 * or auth error (see classifyProviderError). Returns a function that reports whether it tripped.
 */
export function watchProviderErrors(models: Record<string, ErrorEmitter>, onTrip: (cls: ProviderErrorClass, source: string) => void): () => boolean {
  let tripped = false;
  for (const [source, model] of Object.entries(models)) {
    model.on('error', (ev) => {
      if (tripped) return;
      const cls = classifyProviderError(ev?.error, ev?.recoverable ?? false);
      if (!cls) return;
      tripped = true;
      try {
        onTrip(cls, source);
      } catch {
        // The handler must never throw into the SDK's emitter.
      }
    });
  }
  return () => tripped;
}

export const AUTO_PAUSE_PREFIX = 'provider_credit';

/**
 * Pauses the demo in the database and sends one `provider_credit` alert (auto pause and alert are
 * one kind: the email says the demo was paused). Never throws. If the pause write fails, the alert
 * still goes out and says so.
 */
export async function autoPause(
  ops: DemoStatePort,
  alerter: Alerter,
  cls: ProviderErrorClass,
  source: string,
  now: Date,
  logger: PinoLike,
): Promise<{ paused: boolean }> {
  const reason = `${AUTO_PAUSE_PREFIX}: ${cls.detail} (${source})`;
  let paused = false;
  try {
    await ops.setDemoState({ paused: true, reason, now });
    paused = true;
    logger.warn({ reason }, 'demo paused automatically');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'automatic pause failed: demo_state not written');
  }
  await alerter.send('provider_credit', {
    detail: `${cls.kind}: ${cls.detail}, ${source}`,
    note: paused ? null : 'The automatic pause FAILED (database write error). Pause by hand with pnpm demo:pause or DEMO_PAUSED=true.',
  });
  return { paused };
}
