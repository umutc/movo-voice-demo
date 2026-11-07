// Shared harness for behavior tests: real prompt, real tools, real LLM over LiveKit Inference,
// fakes for every port. Never a real SMS, dial or database write.
import { AgentSession, inference, initializeLogger } from '@livekit/agents';
import { FakeDb } from 'db/fake';
import { ATTR, PARTICIPANT_KIND_SIP, SessionContext, resolveIdentity, type AffirmationJudge } from '../src/context.ts';
import { loadConfig } from '../src/config.ts';
import { FakeDialPort, FakeSmsPort } from '../src/ports/index.ts';
import { buildEnrollmentAgent, wireSessionEvents } from '../src/session.ts';

initializeLogger({ pretty: false, level: 'warn' });

export const DEMO = '+17185550100';

/** Deterministic judge for behavior tests; the LLM judge has its own test. */
export const scriptedJudge: AffirmationJudge = async (_readback, reply) =>
  /^\s*(yes|yeah|yep|yup|sure|please|correct|that'?s right|go ahead|book it)/i.test(reply) ? 'yes' : /^\s*(no|nope|not)/i.test(reply) ? 'no' : 'other';

export function testLlm(): inference.LLM {
  const cfg = loadConfig();
  return new inference.LLM({ model: cfg.LK_LLM_MODEL });
}

export type IdentityKind = 'sip-demo' | 'sip-new' | 'browser-demo' | 'browser-real-phone' | 'browser-anon';

export async function makeHarness(kind: IdentityKind, opts: { judge?: AffirmationJudge; llm?: inference.LLM } = {}) {
  const db = new FakeDb({ demoPhone: DEMO });
  const realPhone = '+17185550177';
  if (kind === 'browser-real-phone') {
    const real = await db.createFamily({ phone: realPhone, guardianName: 'Real Parent' });
    await db.upsertFamilySummary(real.id, 'Real Parent asked about U12 for Noah.', new Date());
    await db.findOrCreateChild(real.id, 'Noah', 11);
  }
  const identity =
    kind === 'sip-demo'
      ? resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: DEMO }, jobMetadata: null })
      : kind === 'sip-new'
        ? resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: '+17185550123' }, jobMetadata: null })
        : kind === 'browser-demo'
          ? resolveIdentity({ participantKind: 0, attributes: { [ATTR.phone]: DEMO, [ATTR.guardianName]: 'Jordan' }, jobMetadata: null })
          : kind === 'browser-real-phone'
            ? resolveIdentity({ participantKind: 0, attributes: { [ATTR.phone]: realPhone, [ATTR.guardianName]: 'Someone Else' }, jobMetadata: null })
            : resolveIdentity({ participantKind: 0, attributes: {}, jobMetadata: null });
  const sc = new SessionContext({
    identity,
    db,
    sms: new FakeSmsPort(),
    dial: new FakeDialPort(),
    judge: opts.judge ?? scriptedJudge,
    features: { sms: false, guardian: false },
    roomName: `test-${kind}`,
  });
  await sc.bindFamily();
  const llm = opts.llm ?? testLlm();
  const agent = buildEnrollmentAgent(sc, { academyName: 'Brooklyn Youth Soccer Academy', personaName: 'Maya', variant: 'inbound' });
  const session = new AgentSession<SessionContext>({ llm, userData: sc });
  wireSessionEvents(session, sc);
  await session.start({ agent });
  return { db, sc, session, llm, agent };
}
