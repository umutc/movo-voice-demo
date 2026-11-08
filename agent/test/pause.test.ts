// DEMO_PAUSED: the agent entry ends the job before any session, database or inference work.
// Fakes and mocks only, no LLM, no network.
import { initializeLogger } from '@livekit/agents';
import type * as Agents from '@livekit/agents';
import type { JobContext } from '@livekit/agents';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openDb = vi.fn(() => {
  throw new Error('openDb must not run while paused');
});
const sessionCtor = vi.fn();

vi.mock('db', () => ({ openDb }));
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

initializeLogger({ pretty: false, level: 'warn' });

function fakeJob(roomName = 'call-_+15550001111_abc') {
  const calls = { deleted: [] as (string | undefined)[], shutdown: [] as (string | undefined)[], connect: 0, waitForParticipant: 0 };
  const ctx = {
    isFakeJob: false,
    job: { id: 'AJ_test', room: { name: roomName }, metadata: '' },
    room: { name: roomName },
    connect: async () => void (calls.connect += 1),
    waitForParticipant: async () => {
      calls.waitForParticipant += 1;
      return null;
    },
    deleteRoom: async (name?: string) => void calls.deleted.push(name),
    shutdown: (reason?: string) => void calls.shutdown.push(reason),
    addShutdownCallback: () => {},
  };
  return { ctx: ctx as unknown as JobContext, calls };
}

function stubBaseEnv(paused: string) {
  vi.stubEnv('LIVEKIT_URL', 'wss://example.livekit.cloud');
  vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
  vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret');
  vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/test');
  vi.stubEnv('DEMO_PAUSED', paused);
}

afterEach(() => {
  vi.unstubAllEnvs();
  openDb.mockClear();
  sessionCtor.mockClear();
});

describe('DEMO_PAUSED', () => {
  it('ends the call at entry: deletes the room, shuts the job down, no session and no database', async () => {
    stubBaseEnv('true');
    const { default: agent } = await import('../src/agent.ts');
    const { ctx, calls } = fakeJob();
    await agent.entry(ctx);
    expect(calls.deleted).toEqual(['call-_+15550001111_abc']);
    expect(calls.shutdown).toEqual(['demo paused']);
    expect(calls.connect).toBe(0);
    expect(calls.waitForParticipant).toBe(0);
    expect(openDb).not.toHaveBeenCalled();
    expect(sessionCtor).not.toHaveBeenCalled();
  });

  it('does not take the pause path when DEMO_PAUSED is false', async () => {
    stubBaseEnv('false');
    const { default: agent } = await import('../src/agent.ts');
    const { ctx, calls } = fakeJob();
    // The normal path opens the database first; the mock throws to stop it there.
    await expect(agent.entry(ctx)).rejects.toThrow('openDb must not run while paused');
    expect(openDb).toHaveBeenCalledTimes(1);
    expect(calls.shutdown).toEqual([]);
  });

  it('parses DEMO_PAUSED with Zod, default false', async () => {
    const { loadConfig } = await import('../src/config.ts');
    const base = { LIVEKIT_URL: 'wss://x.livekit.cloud', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', DATABASE_URL: 'postgres://u:p@h:5432/d' };
    expect(loadConfig({ ...base }).DEMO_PAUSED).toBe(false);
    expect(loadConfig({ ...base, DEMO_PAUSED: 'true' }).DEMO_PAUSED).toBe(true);
    expect(loadConfig({ ...base, DEMO_PAUSED: 'false' }).DEMO_PAUSED).toBe(false);
    expect(() => loadConfig({ ...base, DEMO_PAUSED: 'yes' })).toThrow(/DEMO_PAUSED/);
  });
});
