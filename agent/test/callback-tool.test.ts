// request_human_callback handler without an LLM: which number lands on the callback row, and
// that an incomplete number is refused instead of stored.
import { describe, expect, it } from 'vitest';
import { FakeDb } from 'db/fake';
import { ATTR, PARTICIPANT_KIND_SIP, SessionContext, resolveIdentity } from '../src/context.ts';
import { FakeDialPort, FakeSmsPort } from '../src/ports/index.ts';
import { requestHumanCallback } from '../src/tools/request_human_callback.ts';

function setup(identity: ReturnType<typeof resolveIdentity>) {
  const db = new FakeDb({ demoPhone: '+15555550100' });
  const sc = new SessionContext({ identity, db, sms: new FakeSmsPort(), dial: new FakeDialPort(), judge: async () => 'other', features: { sms: false, guardian: false }, roomName: 'test-room' });
  const run = (args: { reason: string; phone?: string; preferred_time?: string }) =>
    requestHumanCallback.execute(args, { ctx: { userData: sc }, toolCallId: 'call-1' } as never) as Promise<{ sayThis: string; callbackId?: string }>;
  return { db, sc, run };
}

const anon = () => resolveIdentity({ participantKind: 0, attributes: {}, jobMetadata: null });
const sip = () => resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: '+17185550123' }, jobMetadata: null });

describe('request_human_callback handler', () => {
  it('stores the confirmed number in E.164 and promises no timeframe', async () => {
    const { db, sc, run } = setup(anon());
    const out = await run({ reason: 'registration next season', phone: '718 555 0142' });
    expect([...db.callbacks.values()][0]?.phone).toBe('+17185550142');
    expect(out.sayThis).toBe("I've passed your question and number to the academy staff.");
    expect(out.sayThis).not.toMatch(/business day|will call/i);
    expect(sc.outcome).toBe('callback');
  });

  it('refuses an incomplete number and stores nothing', async () => {
    const { db, sc, run } = setup(anon());
    const out = await run({ reason: 'registration next season', phone: '718555042' });
    expect(db.callbacks.size).toBe(0);
    expect(out.sayThis).toMatch(/^Sorry, that number looks incomplete/);
    expect(sc.toolLog.at(-1)).toMatchObject({ name: 'request_human_callback', ok: false });
  });

  it('uses the caller id when no number is passed', async () => {
    const { db, run } = setup(sip());
    const out = await run({ reason: 'refund policy', preferred_time: 'mornings' });
    expect([...db.callbacks.values()][0]?.phone).toBe('+17185550123');
    expect(out.sayThis).toBe("I've passed your question and number to the academy staff. I noted that mornings works best for you.");
  });

  it('says honestly that there is no number when none is known or given', async () => {
    const { db, run } = setup(anon());
    const out = await run({ reason: 'future options for a three year old' });
    expect([...db.callbacks.values()][0]?.phone).toBeNull();
    expect(out.sayThis).toBe("I've passed your question to the academy staff, but they have no number to reach you.");
  });
});
