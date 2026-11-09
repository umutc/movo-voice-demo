// Email alerts for the demo owner, shared by the agent, the web token route and the scripts.
// AlertPort is the side effect; SnsAlertPort publishes to an SNS topic with an email subscription.
// SnsAlertPort signs the SNS Query API call with SigV4 over fetch: no AWS SDK dependency.
// Alerter adds the cooldown dedupe (alerts table, see db/ops.ts), an in-process throttle when the
// database is unreachable, and short timeouts. Alerter.send never throws.
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import type { AlertLogPort } from './ops.ts';

export type AlertKind = 'provider_credit' | 'daily_limit' | 'fail_closed' | 'test';

export interface AlertMessage {
  subject: string;
  body: string;
}

export interface AlertPort {
  /** False for the no-op port: nothing is sent and no alert row is written. */
  readonly enabled: boolean;
  publish(msg: AlertMessage): Promise<void>;
}

export type AlertLog = (level: 'info' | 'warn', msg: string, fields?: Record<string, unknown>) => void;

const consoleLog: AlertLog = (level, msg, fields) => {
  (level === 'warn' ? console.warn : console.info)(`[alerts] ${msg}`, fields ?? {});
};

// ---------- message content ----------

const TEXT: Record<AlertKind, { what: string; cause: string; next: string }> = {
  provider_credit: {
    what: 'The agent got a credit, quota or auth error from LiveKit Inference and paused the demo automatically (demo_state row). Visitors see a paused notice and the phone line hangs up at once.',
    cause: 'The LiveKit Inference credit ran out, or the API key lost access.',
    next: 'Top up the credit or fix the key, then run `pnpm demo:resume`. Check the state with `pnpm demo:status`.',
  },
  daily_limit: {
    what: 'The global daily call cap (DEMO_LIMIT_GLOBAL_PER_DAY) was reached. New calls are refused until 00:00 UTC.',
    cause: 'Normal demo traffic, or someone calling the demo many times.',
    next: 'Nothing if this is expected. If it looks like abuse, pause with `pnpm demo:pause -- "<reason>"`, or raise the cap in the Amplify env and the agent secrets.',
  },
  fail_closed: {
    what: 'A usage count or pause check failed, so calls are being refused (fail closed).',
    cause: 'The Supabase database is unreachable, or the pooler is out of connections.',
    next: 'Check the Supabase project status and DATABASE_URL. Calls are admitted again on their own once the database answers.',
  },
  test: {
    what: 'Test alert sent by `pnpm alerts:test`.',
    cause: 'A manual check of the alert path.',
    next: 'Nothing. If you can read this, email alerts work.',
  },
};

/** Keeps a detail label short and plain: no @ or + (emails, phones), no long digit runs. */
export function cleanDetail(detail: string | null | undefined): string | null {
  const d = (detail ?? '')
    .replace(/[^A-Za-z0-9 _.,:;()/=-]/g, '')
    .replace(/\d{7,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return d === '' ? null : d;
}

/** Subject `[movo-voice-demo] <kind>` plus a short plain-text body. No secrets or caller data. */
export function buildAlert(kind: AlertKind, input: { now: Date; detail?: string | null; note?: string | null }): AlertMessage {
  const t = TEXT[kind];
  const lines = [`Time (UTC): ${input.now.toISOString()}`, `What happened: ${t.what}`, `Likely cause: ${t.cause}`, `Next step: ${t.next}`];
  const detail = cleanDetail(input.detail);
  if (detail) lines.push(`Detail: ${detail}`);
  const note = cleanDetail(input.note);
  if (note) lines.push(`Note: ${note}`);
  lines.push('', 'Sent by movo-voice-demo (prototype). The same kind sends at most once per ALERTS_COOLDOWN_HOURS.');
  return { subject: `[movo-voice-demo] ${kind}`, body: lines.join('\n') };
}

// ---------- SigV4 + SNS ----------

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: string | Buffer, s: string): Buffer => createHmac('sha256', key).update(s, 'utf8').digest();

/** `20150830T123600Z` */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * AWS Signature Version 4 for one request. `query` is the canonical query string (already sorted
 * and encoded); `headers` must not repeat host or x-amz-date, they are added here.
 */
export function signV4(req: {
  method: string;
  host: string;
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body: string;
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}): { authorization: string; amzDate: string; signature: string } {
  const stamp = amzDate(req.date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = { host: req.host, 'x-amz-date': stamp };
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [req.method, req.path, req.query ?? '', canonicalHeaders, signedHeaders, sha256(req.body)].join('\n');
  const scope = `${day}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${req.secretAccessKey}`, day), req.region), req.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate: stamp,
    signature,
  };
}

export interface SnsConfig {
  topicArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** SNS Publish (Query API, version 2010-03-31) signed with SigV4. */
export class SnsAlertPort implements AlertPort {
  readonly enabled = true;
  private readonly cfg: SnsConfig;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(cfg: SnsConfig, opts: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.cfg = cfg;
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async publish(msg: AlertMessage): Promise<void> {
    const host = `sns.${this.cfg.region}.amazonaws.com`;
    const body = new URLSearchParams({
      Action: 'Publish',
      Version: '2010-03-31',
      TopicArn: this.cfg.topicArn,
      // SNS email subjects: ASCII, one line, under 100 characters.
      Subject: msg.subject.replace(/[^\x20-\x7e]/g, '').slice(0, 99),
      Message: msg.body,
    }).toString();
    const contentType = 'application/x-www-form-urlencoded; charset=utf-8';
    const sig = signV4({
      method: 'POST',
      host,
      path: '/',
      headers: { 'content-type': contentType },
      body,
      service: 'sns',
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      date: new Date(),
    });
    const res = await this.fetchFn(`https://${host}/`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-amz-date': sig.amzDate, authorization: sig.authorization },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      // The AWS error code (for example AuthorizationError) is safe to log; the body is not echoed.
      const code = /<Code>([A-Za-z.]+)<\/Code>/.exec(await res.text().catch(() => ''))?.[1] ?? 'unknown';
      throw new Error(`SNS publish failed: HTTP ${res.status} ${code}`);
    }
  }
}

/** Used when ALERTS_* is not configured: logs once, sends nothing. */
export class NoopAlertPort implements AlertPort {
  readonly enabled = false;
  private logged = false;
  private readonly log: AlertLog;
  private readonly why: string;
  constructor(log: AlertLog = consoleLog, why = 'ALERTS_* is not set') {
    this.log = log;
    this.why = why;
  }
  async publish(msg: AlertMessage): Promise<void> {
    if (this.logged) return;
    this.logged = true;
    this.log('info', `email alerts are off (${this.why}); not sent`, { subject: msg.subject });
  }
}

/** Records messages; set `fail` to make publish reject, `delayMs` to make it slow. */
export class FakeAlertPort implements AlertPort {
  readonly enabled = true;
  sent: AlertMessage[] = [];
  fail: Error | null = null;
  delayMs = 0;
  async publish(msg: AlertMessage): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw this.fail;
    this.sent.push(msg);
  }
}

// ---------- env ----------

const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v), s.optional());

const alertsEnvSchema = z.object({
  ALERTS_SNS_TOPIC_ARN: optional(z.string().regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/, 'must be an SNS topic ARN')),
  ALERTS_AWS_ACCESS_KEY_ID: optional(z.string().min(1)),
  ALERTS_AWS_SECRET_ACCESS_KEY: optional(z.string().min(1)),
  ALERTS_AWS_REGION: optional(z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'must be an AWS region')),
  ALERTS_COOLDOWN_HOURS: optional(z.coerce.number().positive().max(720)),
});

export interface AlertsEnv {
  sns: SnsConfig | null;
  cooldownMs: number;
  /** Why alerts are off, when they are: names only, never values. */
  off: string | null;
}

export const DEFAULT_COOLDOWN_HOURS = 6;

/** Parses ALERTS_* with Zod. Never throws: an invalid or partial set turns alerts off. */
export function parseAlertsEnv(env: Record<string, string | undefined> = process.env): AlertsEnv {
  const parsed = alertsEnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    return { sns: null, cooldownMs: DEFAULT_COOLDOWN_HOURS * 3_600_000, off: `invalid ${keys}` };
  }
  const e = parsed.data;
  const cooldownMs = (e.ALERTS_COOLDOWN_HOURS ?? DEFAULT_COOLDOWN_HOURS) * 3_600_000;
  if (!e.ALERTS_SNS_TOPIC_ARN || !e.ALERTS_AWS_ACCESS_KEY_ID || !e.ALERTS_AWS_SECRET_ACCESS_KEY) {
    const any = e.ALERTS_SNS_TOPIC_ARN || e.ALERTS_AWS_ACCESS_KEY_ID || e.ALERTS_AWS_SECRET_ACCESS_KEY;
    return { sns: null, cooldownMs, off: any ? 'ALERTS_* is only partly set' : 'ALERTS_* is not set' };
  }
  const region = e.ALERTS_AWS_REGION ?? e.ALERTS_SNS_TOPIC_ARN.split(':')[3] ?? 'us-east-1';
  return {
    sns: { topicArn: e.ALERTS_SNS_TOPIC_ARN, accessKeyId: e.ALERTS_AWS_ACCESS_KEY_ID, secretAccessKey: e.ALERTS_AWS_SECRET_ACCESS_KEY, region },
    cooldownMs,
    off: null,
  };
}

/** The real SNS port when ALERTS_* is set, otherwise a no-op that logs once. */
export function alertPortFromEnv(env: AlertsEnv, log: AlertLog = consoleLog): AlertPort {
  return env.sns ? new SnsAlertPort(env.sns) : new NoopAlertPort(log, env.off ?? 'ALERTS_* is not set');
}

// ---------- Alerter ----------

export type AlertOutcome = 'sent' | 'duplicate' | 'throttled' | 'failed' | 'disabled';

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Process-wide fallback throttle: kind -> last send time (ms). Survives across jobs and requests. */
export const processThrottle = new Map<string, number>();

export interface AlerterOptions {
  port: AlertPort;
  /** The alert log for the cooldown dedupe; null means the in-process throttle only. */
  log: AlertLogPort | null;
  cooldownMs: number;
  logger?: AlertLog;
  throttle?: Map<string, number>;
  claimTimeoutMs?: number;
  publishTimeoutMs?: number;
  now?: () => Date;
}

export class Alerter {
  private readonly o: Required<Omit<AlerterOptions, 'log'>> & { log: AlertLogPort | null };

  constructor(opts: AlerterOptions) {
    this.o = {
      logger: consoleLog,
      throttle: processThrottle,
      claimTimeoutMs: 1500,
      publishTimeoutMs: 3000,
      now: () => new Date(),
      ...opts,
    };
  }

  /**
   * Sends one alert of `kind` unless the same kind went out within the cooldown. The dedupe uses the
   * alerts table; when the database fails, the in-process throttle decides instead, so an outage
   * produces one email per process, not one per request. Never throws; bounded by the timeouts.
   */
  async send(kind: AlertKind, input: { detail?: string | null; note?: string | null } = {}): Promise<AlertOutcome> {
    try {
      const { port, log, cooldownMs, throttle, logger } = this.o;
      if (!port.enabled) {
        await port.publish(buildAlert(kind, { now: this.o.now(), ...input })).catch(() => {});
        return 'disabled';
      }
      const now = this.o.now();
      const detail = cleanDetail(input.detail);
      let claimed: boolean | null = null;
      if (log) {
        try {
          claimed = await withTimeout(log.claimAlert({ kind, detail, now, cooldownMs }), this.o.claimTimeoutMs, 'alert dedupe');
        } catch (err) {
          logger('warn', 'alert dedupe unavailable, using the in-process throttle', { kind, error: errText(err) });
        }
      }
      if (claimed === false) return 'duplicate';
      if (claimed === null) {
        const last = throttle.get(kind);
        if (last !== undefined && now.getTime() - last < cooldownMs) return 'throttled';
      }
      throttle.set(kind, now.getTime());
      await withTimeout(port.publish(buildAlert(kind, { now, ...input })), this.o.publishTimeoutMs, 'alert publish');
      logger('info', 'alert sent', { kind });
      return 'sent';
    } catch (err) {
      try {
        this.o.logger('warn', 'alert failed', { kind, error: errText(err) });
      } catch {
        // A broken logger must not break the caller either.
      }
      return 'failed';
    }
  }
}
