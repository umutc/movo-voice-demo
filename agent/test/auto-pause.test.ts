// Automatic pause on a provider credit, quota or auth error, and the database pause switch at
// call entry. Mocked model errors and fakes only: no LLM, no SNS, no database, no network.
import { EventEmitter } from 'node:events';
import { APIStatusError, initializeLogger } from '@livekit/agents';
import type * as Agents from '@livekit/agents';
import type { JobContext } from '@livekit/agents';
import { Alerter, FakeAlertPort } from 'db/alerts';
import { FakeOps } from 'db/ops';
import type * as OpsModule from 'db/ops';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoPause, watchProviderErrors } from '../src/alerts.ts';
import { checkDbPause } from '../src/pause.ts';
import { classifyProviderError } from '../src/provider-errors.ts';

const shared = vi.hoisted(() => ({ ops: null as unknown as FakeOps }));
const openDb = vi.fn((_url?: string) => ({ port: {}, db: {}, close: async () => {} }));
const sessionCtor = vi.fn();

vi.mock('db', () => ({ openDb }));
vi.mock('db/ops', async (importOriginal) => {
  const actual = await importOriginal<typeof OpsModule>();
  // The agent builds DrizzleOps on its connection; here it forwards to the shared fake.
  class DrizzleOps {
    getDemoState() {
      return shared.ops.getDemoState();
    }
    setDemoState(input: Parameters<FakeOps['setDemoState']>[0]) {
      return shared.ops.setDemoState(input);
    }
    claimAlert(input: Parameters<FakeOps['claimAlert']>[0]) {
      return shared.ops.claimAlert(input);
    }
  }
  return { ...actual, DrizzleOps };
});
vi.mock('@livekit/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof Agents>();
  class NoSession {
    constructor() {
      sessionCtor();
      throw new Error('AgentSession must not start while paused');
    }
  }
  return { ...actual, AgentSession: NoSession };
});

initializeLogger({ pretty: false, level: 'silent' });
const logger = { info: () => {}, warn: () => {} };
const HOUR = 3_600_000;

function gateway429(): APIStatusError {
  return new APIStatusError({
    message: '429 MaxGatewayCredits',
    options: { statusCode: 429, body: { code: 'MaxGatewayCredits', message: 'gateway credits exhausted, 0 remaining' }, retryable: true },
  });
}

beforeEach(() => {
  shared.ops = new FakeOps();
  // .env is loaded by `pnpm test`: blank the real SNS settings so no test can send an email.
  for (const k of ['ALERTS_SNS_TOPIC_ARN', 'ALERTS_AWS_ACCESS_KEY_ID', 'ALERTS_AWS_SECRET_ACCESS_KEY']) vi.stubEnv(k, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  openDb.mockClear();
  sessionCtor.mockClear();
});

describe('classifyProviderError', () => {
  it('pauses on credit wording and auth errors, not on a recoverable bare 429', () => {
    expect(classifyProviderError(gateway429(), true)).toEqual({ kind: 'credit', detail: '429 MaxGatewayCredits' });
    expect(classifyProviderError(new APIStatusError({ message: 'unauthorized', options: { statusCode: 401 } }), true)).toEqual({ kind: 'auth', detail: '401 unauthorized' });
    const rateLimited = new APIStatusError({ message: 'too many requests', options: { statusCode: 429, retryable: true } });
    expect(classifyProviderError(rateLimited, true)).toBeNull();
    expect(classifyProviderError(rateLimited, false)).toEqual({ kind: 'credit', detail: '429' });
    expect(classifyProviderError(new Error('socket hang up'), false)).toBeNull();
  });
});

describe('automatic pause', () => {
  it('a mocked credit error on any model pauses the demo once and sends one provider_credit alert', async () => {
    const stt = new EventEmitter();
    const llm = new EventEmitter();
    const tts = new EventEmitter();
    const port = new FakeAlertPort();
    const alerter = new Alerter({ port, log: shared.ops, cooldownMs: 6 * HOUR, logger: () => {}, throttle: new Map() });
    const done: Promise<unknown>[] = [];
    const tripped = watchProviderErrors({ stt, llm, tts }, (cls, source) => done.push(autoPause(shared.ops, alerter, cls, source, new Date('2026-11-09T12:00:00Z'), logger)));

    tts.emit('error', { type: 'tts_error', error: new Error('socket hang up'), recoverable: true });
    expect(tripped()).toBe(false);
    llm.emit('error', { type: 'llm_error', error: gateway429(), recoverable: true });
    stt.emit('error', { type: 'stt_error', error: gateway429(), recoverable: false });
    await Promise.all(done);

    expect(tripped()).toBe(true);
    expect(done).toHaveLength(1);
    expect(shared.ops.state).toMatchObject({ paused: true, reason: 'provider_credit: 429 MaxGatewayCredits (llm)' });
    expect(port.sent.map((m) => m.subject)).toEqual(['[movo-voice-demo] provider_credit']);
    expect(port.sent[0]!.body).toContain('Detail: credit: 429 MaxGatewayCredits, llm');
  });

  it('when the pause write fails, the alert still goes out and says so; nothing throws', async () => {
    shared.ops.down = true;
    const port = new FakeAlertPort();
    const alerter = new Alerter({ port, log: shared.ops, cooldownMs: HOUR, logger: () => {}, throttle: new Map() });
    await expect(autoPause(shared.ops, alerter, { kind: 'credit', detail: '429' }, 'tts', new Date(), logger)).resolves.toEqual({ paused: false });
    expect(port.sent[0]!.body).toContain('automatic pause FAILED');
  });
});

describe('database pause at call entry', () => {
  function fakeJob(roomName = 'web-abc123') {
    const calls = { deleted: [] as (string | undefined)[], shutdown: [] as (string | undefined)[], connect: 0 };
    const ctx = {
      isFakeJob: false,
      job: { id: 'AJ_test', room: { name: roomName }, metadata: '' },
      room: { name: roomName },
      connect: async () => void (calls.connect += 1),
      waitForParticipant: async () => null,
      deleteRoom: async (name?: string) => void calls.deleted.push(name),
      shutdown: (reason?: string) => void calls.shutdown.push(reason),
      addShutdownCallback: () => {},
    };
    return { ctx: ctx as unknown as JobContext, calls };
  }

  function stubBaseEnv() {
    vi.stubEnv('LIVEKIT_URL', 'wss://example.livekit.cloud');
    vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
    vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret');
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/test');
    vi.stubEnv('DEMO_PAUSED', 'false');
  }

  it('demo_state paused: the room is deleted before connect, no session starts', async () => {
    stubBaseEnv();
    shared.ops.state = { paused: true, reason: 'manual pause', updatedAt: new Date() };
    const { default: agent } = await import('../src/agent.ts');
    const { ctx, calls } = fakeJob();
    await agent.entry(ctx);
    expect(calls.deleted).toEqual(['web-abc123']);
    expect(calls.shutdown).toEqual(['demo paused']);
    expect(calls.connect).toBe(0);
    expect(sessionCtor).not.toHaveBeenCalled();
  });

  it('a failed pause check fails closed: the call ends without a session', async () => {
    stubBaseEnv();
    shared.ops.down = true;
    const { default: agent } = await import('../src/agent.ts');
    const { ctx, calls } = fakeJob();
    await agent.entry(ctx);
    expect(calls.deleted).toEqual(['web-abc123']);
    expect(calls.connect).toBe(0);
    expect(sessionCtor).not.toHaveBeenCalled();
  });

  it('checkDbPause returns the error instead of throwing, and times out', async () => {
    expect(await checkDbPause({ getDemoState: () => Promise.reject(new Error('down')) })).toEqual({ ok: false, error: 'down' });
    expect(await checkDbPause({ getDemoState: () => new Promise(() => {}) }, 20)).toEqual({ ok: false, error: 'pause check timed out after 20 ms' });
  });
});
