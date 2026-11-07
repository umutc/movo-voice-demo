// Demo spend guards: phone quota and max call length. Fakes only, no LLM, no network.
import { AgentSession, AgentSessionEventTypes, initializeLogger } from '@livekit/agents';
import { FakeDb } from 'db/fake';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_DURATION_GOODBYE, PHONE_LINE_CLOSED, admitPhoneCall, buildClosedLineAgent, startCallTimer, type EndableSession } from '../src/limits.ts';

initializeLogger({ pretty: false, level: 'warn' });

function fakeSession() {
  const said: string[] = [];
  const shutdowns: { drain?: boolean; reason?: string }[] = [];
  const done: (() => void)[] = [];
  const session: EndableSession = {
    say: (text) => {
      said.push(text);
      return { addDoneCallback: (cb) => void done.push(cb) };
    },
    shutdown: (opts) => void shutdowns.push(opts ?? {}),
  };
  return { session, said, shutdowns, finishPlayout: () => done.splice(0).forEach((cb) => cb()) };
}

describe('phone quota', () => {
  it('refuses a phone call once the global daily limit is reached and records nothing', async () => {
    const db = new FakeDb();
    const now = new Date();
    await db.reserveDemoUsage({ channel: 'web', now, ipHash: 'ip-a' });
    await db.reserveDemoUsage({ channel: 'web', now, ipHash: 'ip-b' });
    expect(await admitPhoneCall(db, 2, now)).toEqual({ admitted: false });
    expect(await db.countDemoUsage({ now })).toBe(2);
  });

  it('admits a phone call under the limit and records one phone row', async () => {
    const db = new FakeDb();
    const now = new Date();
    expect(await admitPhoneCall(db, 2, now)).toEqual({ admitted: true });
    expect(db.demoUsage.map((r) => r.channel)).toEqual(['phone']);
  });

  it('with no limit set, admits and records nothing (local development)', async () => {
    const db = new FakeDb();
    expect(await admitPhoneCall(db, undefined, new Date())).toEqual({ admitted: true });
    expect(await admitPhoneCall(db, 0, new Date())).toEqual({ admitted: true });
    expect(db.demoUsage).toHaveLength(0);
  });

  it('fails closed when the count throws', async () => {
    const broken = { reserveDemoUsage: async () => Promise.reject(new Error('db down')) };
    expect(await admitPhoneCall(broken, 2, new Date())).toEqual({ admitted: false, error: 'db down' });
  });

  it('the closed-line agent says one sentence and ends the session', async () => {
    const session = new AgentSession({});
    const closed = new Promise<string>((resolve) => session.on(AgentSessionEventTypes.Close, (ev) => resolve(String(ev.reason))));
    const spoken: string[] = [];
    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item.type === 'message' && ev.item.role === 'assistant') spoken.push(ev.item.textContent ?? '');
    });
    await session.start({ agent: buildClosedLineAgent() });
    expect(await closed).toBe('daily_limit');
    expect(spoken).toEqual([PHONE_LINE_CLOSED]);
  });
});

describe('max call length', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says the goodbye at the limit, then ends through a drain shutdown', () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const onLimit = vi.fn();
    startCallTimer(f.session, 180, onLimit);
    vi.advanceTimersByTime(179_000);
    expect(f.said).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(onLimit).toHaveBeenCalledOnce();
    expect(f.said).toEqual([MAX_DURATION_GOODBYE]);
    expect(f.shutdowns).toEqual([]);
    f.finishPlayout();
    expect(f.shutdowns).toEqual([{ drain: true, reason: 'max_duration' }]);
    vi.advanceTimersByTime(60_000);
    expect(f.shutdowns).toHaveLength(1);
  });

  it('forces a shutdown when the goodbye never finishes playing', () => {
    vi.useFakeTimers();
    const f = fakeSession();
    startCallTimer(f.session, 5);
    vi.advanceTimersByTime(5_000 + 30_000);
    expect(f.shutdowns).toEqual([{ drain: false, reason: 'max_duration' }]);
  });

  it('a call that closes first clears the timer', () => {
    vi.useFakeTimers();
    const f = fakeSession();
    const stop = startCallTimer(f.session, 5);
    vi.advanceTimersByTime(4_000);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(f.said).toEqual([]);
    expect(f.shutdowns).toEqual([]);
  });

  it('0 turns the timer off', () => {
    vi.useFakeTimers();
    const f = fakeSession();
    startCallTimer(f.session, 0);
    vi.advanceTimersByTime(3_600_000);
    expect(f.said).toEqual([]);
  });
});
