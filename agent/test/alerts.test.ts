// Alert module (db/alerts.ts): cooldown dedupe, the DB-down throttle, timeouts, message content and
// the SigV4 signer. Fakes only: no SNS call, no database, no network.
import { describe, expect, it } from 'vitest';
import { Alerter, buildAlert, cleanDetail, FakeAlertPort, NoopAlertPort, parseAlertsEnv, signV4, SnsAlertPort } from 'db/alerts';
import { FakeOps } from 'db/ops';

const HOUR = 3_600_000;
const quiet = () => {};

function setup(opts: { now?: Date } = {}) {
  const port = new FakeAlertPort();
  const ops = new FakeOps();
  const throttle = new Map<string, number>();
  let now = opts.now ?? new Date('2026-11-09T12:00:00Z');
  const alerter = new Alerter({ port, log: ops, cooldownMs: 6 * HOUR, logger: quiet, throttle, now: () => now, claimTimeoutMs: 50, publishTimeoutMs: 50 });
  return { port, ops, throttle, alerter, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('Alerter cooldown dedupe', () => {
  it('sends a kind once per cooldown, per kind, and again after the cooldown', async () => {
    const { port, ops, alerter, advance } = setup();
    expect(await alerter.send('daily_limit')).toBe('sent');
    expect(await alerter.send('daily_limit')).toBe('duplicate');
    expect(await alerter.send('fail_closed')).toBe('sent');
    advance(5 * HOUR);
    expect(await alerter.send('daily_limit')).toBe('duplicate');
    advance(1 * HOUR + 1);
    expect(await alerter.send('daily_limit')).toBe('sent');
    expect(port.sent.map((m) => m.subject)).toEqual(['[movo-voice-demo] daily_limit', '[movo-voice-demo] fail_closed', '[movo-voice-demo] daily_limit']);
    expect(ops.alerts.map((a) => a.kind)).toEqual(['daily_limit', 'fail_closed', 'daily_limit']);
  });

  it('the dedupe holds across Alerter instances (one per request) through the shared log', async () => {
    const { port, ops } = setup();
    const make = () => new Alerter({ port, log: ops, cooldownMs: 6 * HOUR, logger: quiet, throttle: new Map() });
    expect(await make().send('fail_closed')).toBe('sent');
    expect(await make().send('fail_closed')).toBe('duplicate');
    expect(port.sent).toHaveLength(1);
  });
});

describe('Alerter with the database down', () => {
  it('falls back to the in-process throttle: one email for a burst of failures, not hundreds', async () => {
    const { port, ops, alerter, advance } = setup();
    ops.down = true;
    const outcomes = await Promise.all(Array.from({ length: 50 }, () => alerter.send('fail_closed')));
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'throttled')).toHaveLength(49);
    expect(port.sent).toHaveLength(1);
    advance(6 * HOUR + 1);
    expect(await alerter.send('fail_closed')).toBe('sent');
  });

  it('a slow database counts as down (claim timeout)', async () => {
    const { port, ops, alerter } = setup();
    ops.claimAlert = () => new Promise(() => {});
    expect(await alerter.send('fail_closed')).toBe('sent');
    expect(await alerter.send('fail_closed')).toBe('throttled');
    expect(port.sent).toHaveLength(1);
  });

  it('a send while the database was up also seeds the throttle', async () => {
    const { ops, alerter } = setup();
    expect(await alerter.send('daily_limit')).toBe('sent');
    ops.down = true;
    expect(await alerter.send('daily_limit')).toBe('throttled');
  });
});

describe('Alerter never throws into the caller', () => {
  it('a failing publish returns failed', async () => {
    const { port, alerter } = setup();
    port.fail = new Error('SNS down');
    await expect(alerter.send('provider_credit')).resolves.toBe('failed');
  });

  it('a hanging publish is cut off by the timeout', async () => {
    const { port, alerter } = setup();
    port.delayMs = 5_000;
    const started = Date.now();
    await expect(alerter.send('provider_credit')).resolves.toBe('failed');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('a throwing logger and a throwing log port still resolve', async () => {
    const port = new FakeAlertPort();
    port.fail = new Error('boom');
    const alerter = new Alerter({
      port,
      log: { claimAlert: () => Promise.reject(new Error('db')) },
      cooldownMs: HOUR,
      throttle: new Map(),
      logger: () => {
        throw new Error('logger broke');
      },
    });
    await expect(alerter.send('fail_closed')).resolves.toBe('failed');
  });

  it('the no-op port sends nothing, writes no alert row, and logs once', async () => {
    const lines: string[] = [];
    const ops = new FakeOps();
    const alerter = new Alerter({ port: new NoopAlertPort((_l, msg) => lines.push(msg)), log: ops, cooldownMs: HOUR, throttle: new Map() });
    expect(await alerter.send('fail_closed')).toBe('disabled');
    expect(await alerter.send('daily_limit')).toBe('disabled');
    expect(ops.alerts).toHaveLength(0);
    expect(lines).toHaveLength(1);
  });
});

describe('alert content', () => {
  it('has the subject, UTC time, cause and next step, and no caller data', () => {
    const msg = buildAlert('provider_credit', { now: new Date('2026-11-09T12:00:00Z'), detail: 'credit: 429 MaxGatewayCredits, llm' });
    expect(msg.subject).toBe('[movo-voice-demo] provider_credit');
    expect(msg.body).toContain('Time (UTC): 2026-11-09T12:00:00.000Z');
    expect(msg.body).toContain('Likely cause:');
    expect(msg.body).toContain('pnpm demo:resume');
    expect(msg.body).toContain('Detail: credit: 429 MaxGatewayCredits, llm');
  });

  it('strips emails, phone numbers and odd characters from a detail', () => {
    expect(cleanDetail('call from +15550001111 a@b.com')).toBe('call from # ab.com');
    expect(cleanDetail('')).toBeNull();
    expect(cleanDetail('x'.repeat(300))?.length).toBe(100);
  });
});

describe('ALERTS_* env', () => {
  const full = {
    ALERTS_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:movo-voice-demo-alerts',
    ALERTS_AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    ALERTS_AWS_SECRET_ACCESS_KEY: 'secret',
  };
  it('turns on with the three required values, region from the ARN, cooldown default 6 h', () => {
    const cfg = parseAlertsEnv(full);
    expect(cfg.sns?.region).toBe('us-east-1');
    expect(cfg.cooldownMs).toBe(6 * HOUR);
    expect(cfg.off).toBeNull();
    expect(parseAlertsEnv({ ...full, ALERTS_COOLDOWN_HOURS: '2' }).cooldownMs).toBe(2 * HOUR);
  });
  it('stays off when unset, partial or invalid, and names keys only', () => {
    expect(parseAlertsEnv({}).off).toBe('ALERTS_* is not set');
    expect(parseAlertsEnv({ ALERTS_SNS_TOPIC_ARN: full.ALERTS_SNS_TOPIC_ARN }).off).toBe('ALERTS_* is only partly set');
    const bad = parseAlertsEnv({ ...full, ALERTS_SNS_TOPIC_ARN: 'not-an-arn' });
    expect(bad.sns).toBeNull();
    expect(bad.off).toBe('invalid ALERTS_SNS_TOPIC_ARN');
  });
});

describe('SigV4 and the SNS adapter', () => {
  it('matches the AWS SigV4 test suite vector get-vanilla', () => {
    const sig = signV4({
      method: 'GET',
      host: 'example.amazonaws.com',
      path: '/',
      body: '',
      service: 'service',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(sig.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('posts a signed Publish to the regional SNS endpoint and reports AWS error codes', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    let status = 200;
    const port = new SnsAlertPort(
      { topicArn: 'arn:aws:sns:us-east-1:123456789012:t', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', region: 'us-east-1' },
      {
        fetch: async (url, init) => {
          calls.push({ url, headers: init.headers, body: init.body });
          return { ok: status === 200, status, text: async () => '<ErrorResponse><Error><Code>AuthorizationError</Code></Error></ErrorResponse>' };
        },
      },
    );
    await port.publish({ subject: '[movo-voice-demo] test', body: 'hello' });
    const call = calls[0]!;
    expect(call.url).toBe('https://sns.us-east-1.amazonaws.com/');
    const form = new URLSearchParams(call.body);
    expect(form.get('Action')).toBe('Publish');
    expect(form.get('TopicArn')).toBe('arn:aws:sns:us-east-1:123456789012:t');
    expect(form.get('Subject')).toBe('[movo-voice-demo] test');
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/sns\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(call.headers.authorization).not.toContain('secret');
    status = 403;
    await expect(port.publish({ subject: 's', body: 'b' })).rejects.toThrow('SNS publish failed: HTTP 403 AuthorizationError');
  });
});
