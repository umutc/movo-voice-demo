// Pause on the token route: 503 { error: 'paused' } before a token or a demo_usage row, from
// DEMO_PAUSED or the demo_state row; fail closed with an alert when a database check fails.
// Mocks and fakes only, no database, no SNS, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAlertPort } from 'db/alerts';
import { FakeOps } from 'db/ops';
import type * as OpsModule from 'db/ops';
import type * as AlertsModule from 'db/alerts';
import { demoPaused, PAUSED_NOTICE, pausedNotice } from './pause.ts';

type UsageResult = { ok: true; id: string } | { ok: false; reason: 'global_limit' | 'ip_limit' };
const openDb = vi.fn((_url: string): { port: { reserveDemoUsage: () => Promise<UsageResult> }; db: object; close: () => Promise<void> } => {
  throw new Error('openDb must not run while paused');
});
vi.mock('db', () => ({ openDb }));

const shared = vi.hoisted(() => ({ ops: null as unknown as FakeOps, port: null as unknown as FakeAlertPort }));
vi.mock('db/ops', async (importOriginal) => {
  const actual = await importOriginal<typeof OpsModule>();
  class DrizzleOps {
    getDemoState() {
      return shared.ops.getDemoState();
    }
    claimAlert(input: Parameters<FakeOps['claimAlert']>[0]) {
      return shared.ops.claimAlert(input);
    }
  }
  return { ...actual, DrizzleOps };
});
vi.mock('db/alerts', async (importOriginal) => {
  const actual = await importOriginal<typeof AlertsModule>();
  return { ...actual, alertPortFromEnv: () => shared.port };
});

beforeEach(() => {
  shared.ops = new FakeOps();
  shared.port = new FakeAlertPort();
});

const ORIGIN = 'https://movo-voice-demo.umutcelik.com.tr';

function stubEnv(paused: string) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ALLOW_TOKEN_ROUTE', 'true');
  vi.stubEnv('ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('LIVEKIT_URL', 'wss://example.livekit.cloud');
  vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
  vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret');
  vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/test');
  vi.stubEnv('DEMO_LIMIT_PER_IP_PER_DAY', '2');
  vi.stubEnv('DEMO_LIMIT_GLOBAL_PER_DAY', '10');
  vi.stubEnv('DEMO_PAUSED', paused);
  for (const k of ['ALERTS_SNS_TOPIC_ARN', 'ALERTS_AWS_ACCESS_KEY_ID', 'ALERTS_AWS_SECRET_ACCESS_KEY']) vi.stubEnv(k, '');
}

const dbWith = (reserve: () => Promise<UsageResult>) => ({ port: { reserveDemoUsage: reserve }, db: {}, close: async () => {} });

function tokenRequest(): Request {
  return new Request('https://example.test/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ participant_attributes: { 'movo.guardian_name': 'Dana Whitfield', 'movo.consent': 'true' } }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  openDb.mockClear();
});

describe('token route while paused', () => {
  it('returns 503 paused and never opens the database or mints a token', async () => {
    stubEnv('true');
    const { POST } = await import('../app/api/token/route.ts');
    const res = await POST(tokenRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'paused', notice: PAUSED_NOTICE });
    expect(openDb).not.toHaveBeenCalled();
  });

  it('returns 503 paused when the demo_state row is paused, before the usage count', async () => {
    stubEnv('false');
    shared.ops.state = { paused: true, reason: 'provider_credit: 429 MaxGatewayCredits (llm)', updatedAt: new Date() };
    const reserve = vi.fn(async (): Promise<UsageResult> => ({ ok: true, id: 'u1' }));
    openDb.mockImplementationOnce(() => dbWith(reserve));
    const { POST } = await import('../app/api/token/route.ts');
    const res = await POST(tokenRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'paused', notice: pausedNotice({ env: false, reason: 'provider_credit' }) });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('fails closed with 503 and one fail_closed alert when the pause check fails', async () => {
    stubEnv('false');
    shared.ops.down = true;
    const { POST } = await import('../app/api/token/route.ts');
    for (let i = 0; i < 3; i += 1) {
      openDb.mockImplementationOnce(() => dbWith(async () => ({ ok: true, id: 'u1' })));
      const res = await POST(tokenRequest());
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('pause check failed');
    }
    // Database down: the in-process throttle keeps it to one email.
    expect(shared.port.sent.map((m) => m.subject)).toEqual(['[movo-voice-demo] fail_closed']);
  });

  it('fails closed when the usage count throws, and the alert failing does not break the response', async () => {
    stubEnv('false');
    shared.port.fail = new Error('SNS down');
    openDb.mockImplementationOnce(() => dbWith(async () => Promise.reject(new Error('pool exhausted'))));
    const { POST } = await import('../app/api/token/route.ts');
    const res = await POST(tokenRequest());
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('usage check failed');
  });

  it('a full global cap answers 429 and sends one daily_limit alert', async () => {
    stubEnv('false');
    const { POST } = await import('../app/api/token/route.ts');
    for (let i = 0; i < 2; i += 1) {
      openDb.mockImplementationOnce(() => dbWith(async () => ({ ok: false, reason: 'global_limit' })));
      expect((await POST(tokenRequest())).status).toBe(429);
    }
    expect(shared.port.sent.map((m) => m.subject)).toEqual(['[movo-voice-demo] daily_limit']);
  });

  it('when not paused, goes on to the usage check (the database step)', async () => {
    stubEnv('false');
    // A full day: the fake usage check refuses, so no token is minted here either.
    openDb.mockImplementationOnce(() => dbWith(async () => ({ ok: false, reason: 'ip_limit' })));
    const { POST } = await import('../app/api/token/route.ts');
    const res = await POST(tokenRequest());
    expect(openDb).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'daily_limit' });
  });
});

describe('demoPaused', () => {
  it('parses true/false, defaults to false and rejects other values', () => {
    expect(demoPaused({})).toBe(false);
    expect(demoPaused({ DEMO_PAUSED: '' })).toBe(false);
    expect(demoPaused({ DEMO_PAUSED: 'true' })).toBe(true);
    expect(demoPaused({ DEMO_PAUSED: ' false ' })).toBe(false);
    expect(() => demoPaused({ DEMO_PAUSED: 'yes' })).toThrow('DEMO_PAUSED');
  });

  it('maps a pause reason to a fixed notice and never shows the raw reason', () => {
    expect(pausedNotice({ env: true, reason: 'anything' })).toBe(PAUSED_NOTICE);
    expect(pausedNotice({ env: false, reason: 'provider_credit: 429' })).toContain('model credit ran out');
    expect(pausedNotice({ env: false, reason: '<script>' })).toBe('The voice demo is paused right now. The phone line is paused too.');
  });
});
