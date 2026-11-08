// DEMO_PAUSED on the token route: 503 { error: 'paused' } before a token or a demo_usage row.
// Mocks only, no database, no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoPaused } from './pause.ts';

const openDb = vi.fn((_url: string): { port: { reserveDemoUsage: () => Promise<{ ok: boolean }> }; close: () => Promise<void> } => {
  throw new Error('openDb must not run while paused');
});
vi.mock('db', () => ({ openDb }));

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
}

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
    expect(await res.json()).toEqual({ error: 'paused' });
    expect(openDb).not.toHaveBeenCalled();
  });

  it('when not paused, goes on to the usage check (the database step)', async () => {
    stubEnv('false');
    // A full day: the fake usage check refuses, so no token is minted here either.
    openDb.mockImplementationOnce(() => ({ port: { reserveDemoUsage: async () => ({ ok: false }) }, close: async () => {} }));
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
});
