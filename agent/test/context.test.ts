import { describe, expect, it } from 'vitest';
import { FakeDb } from 'db/fake';
import {
  ATTR,
  PARTICIPANT_KIND_SIP,
  ProposalMachine,
  SessionContext,
  normalizePhone,
  readbackMatchScore,
  resolveIdentity,
  type AffirmationJudge,
} from '../src/context.ts';
import { FakeDialPort, FakeSmsPort } from '../src/ports/index.ts';

const DEMO = '+15555550100';
const yesJudge: AffirmationJudge = async (_r, reply) => (/^\s*(yes|yeah|yep|sure|please)/i.test(reply) ? 'yes' : /^\s*(no|nope)/i.test(reply) ? 'no' : 'other');

function makeContext(identity: ReturnType<typeof resolveIdentity>, db = new FakeDb({ demoPhone: DEMO })) {
  return new SessionContext({ identity, db, sms: new FakeSmsPort(), dial: new FakeDialPort(), judge: yesJudge, features: { sms: false, guardian: false }, roomName: 'test-room' });
}

const details = { programId: 'u8-prospect', slotId: 'u8-prospect-2026-11-14-1400', childName: 'Emma', childAge: 7, guardianName: 'Jordan' };
const READBACK = 'Just to confirm: a free trial for Emma, age 7, in Juniors U8 on Saturday, November 14 at 2 in the afternoon with Coach Priya, booked under Jordan. Shall I book that?';

describe('identity resolution', () => {
  it('SIP participant kind gives caller_id_only with the SIP phone', () => {
    const id = resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: '+1 (718) 555-0142', [ATTR.phone]: '+12125550000' }, jobMetadata: null });
    expect(id).toMatchObject({ source: 'caller_id_only', phone: '+17185550142', guardianName: null });
  });

  it('a sip.phoneNumber attribute alone never upgrades a standard participant', () => {
    const id = resolveIdentity({ participantKind: 0, attributes: { [ATTR.sipPhone]: '+17185550142', [ATTR.phone]: '718-555-0142', [ATTR.guardianName]: 'Sam' }, jobMetadata: null });
    expect(id.source).toBe('self_reported');
    expect(id.phone).toBe('+17185550142');
    expect(id.guardianName).toBe('Sam');
  });

  it('dispatch metadata is self_reported', () => {
    const id = resolveIdentity({ participantKind: 0, attributes: {}, jobMetadata: JSON.stringify({ phone: '+17185550142', reason: 'follow_up', familyId: 'fam-0001' }) });
    expect(id).toMatchObject({ source: 'self_reported', phone: '+17185550142', reason: 'follow_up', claimedFamilyId: 'fam-0001' });
  });

  it('normalizes phones to E.164 and rejects junk', () => {
    expect(normalizePhone('(718) 555-0142')).toBe('+17185550142');
    expect(normalizePhone('not a number')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('family binding (PRD section 5)', () => {
  it('caller_id_only loads the family by phone and gets history', async () => {
    const sc = makeContext(resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: DEMO }, jobMetadata: null }));
    await sc.bindFamily();
    expect(sc.familyId).toBe('fam-0001');
    expect(sc.familyHasHistory).toBe(true);
  });

  it('caller_id_only with an unknown phone binds nothing until a tool needs a family, then keys it by phone', async () => {
    const sc = makeContext(resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: '+17185550199' }, jobMetadata: null }));
    await sc.bindFamily();
    expect(sc.familyId).toBeNull();
    const id = await sc.ensureFamily({ guardianName: 'Pat' });
    const fam = await sc.db.findFamilyById(id);
    expect(fam?.phone).toBe('+17185550199');
    expect(fam?.guardianName).toBe('Pat');
    expect(sc.familyHasHistory).toBe(false);
  });

  it('self_reported demo phone loads the demo family', async () => {
    const sc = makeContext(resolveIdentity({ participantKind: 0, attributes: { [ATTR.phone]: DEMO, [ATTR.guardianName]: 'Jordan' }, jobMetadata: null }));
    await sc.bindFamily();
    expect(sc.familyId).toBe('fam-0001');
    expect(sc.familyHasHistory).toBe(true);
  });

  it('self_reported phone of a real (non-demo) family loads nothing and never keys a family by that phone', async () => {
    const db = new FakeDb({ demoPhone: DEMO });
    const real = await db.createFamily({ phone: '+17185550177', guardianName: 'Real Parent' });
    await db.upsertFamilySummary(real.id, 'Private history.', new Date());
    const sc = makeContext(resolveIdentity({ participantKind: 0, attributes: { [ATTR.phone]: '+17185550177', [ATTR.guardianName]: 'Impostor' }, jobMetadata: null }), db);
    await sc.bindFamily();
    expect(sc.familyId).toBeNull();
    expect(sc.family).toBeNull();
    const created = await sc.ensureFamily();
    expect(created).not.toBe(real.id);
    const fresh = await db.findFamilyById(created);
    expect(fresh?.phone).toBeNull();
    expect(fresh?.guardianName).toBe('Impostor');
    const untouched = await db.findFamilyById(real.id);
    expect(untouched?.summary).toBe('Private history.');
  });

  it('self_reported claimed familyId only works for a demo family', async () => {
    const db = new FakeDb({ demoPhone: DEMO });
    const real = await db.createFamily({ phone: '+17185550178', guardianName: 'Real Parent' });
    const bad = makeContext(resolveIdentity({ participantKind: 0, attributes: {}, jobMetadata: JSON.stringify({ familyId: real.id, reason: 'follow_up' }) }), db);
    await bad.bindFamily();
    expect(bad.familyId).toBeNull();
    const good = makeContext(resolveIdentity({ participantKind: 0, attributes: {}, jobMetadata: JSON.stringify({ familyId: 'fam-0001', reason: 'follow_up' }) }), db);
    await good.bindFamily();
    expect(good.familyId).toBe('fam-0001');
  });
});

describe('proposal state machine (PRD FR-14)', () => {
  it('happy path: propose, read-back spoken, yes, book once', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    expect(m.current?.state).toBe('pending');
    m.onAssistantMessage(READBACK, false);
    expect(m.current?.state).toBe('readback_spoken');
    expect(await m.onUserTurn('Yes please', yesJudge)).toBe('yes');
    expect(m.current?.state).toBe('confirmed');
    expect(m.authorize({ programId: details.programId, slotId: details.slotId, childName: ' emma ' })).toBeNull();
    m.consume();
    expect(m.current?.state).toBe('consumed');
    expect(m.authorize({ programId: details.programId, slotId: details.slotId, childName: 'Emma' })).toMatch(/already booked/);
  });

  it('filler speech after the yes does not invalidate anything', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, false);
    await m.onUserTurn('yes', yesJudge);
    m.onAssistantMessage('One moment, let me book that.', false);
    expect(m.current?.state).toBe('confirmed');
    expect(m.authorize(details)).toBeNull();
  });

  it('a paraphrased read-back still counts, an unrelated sentence does not', () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage('Great choice. ' + READBACK.replace('Shall I book that?', 'Shall I book that for you?'), false);
    expect(m.current?.state).toBe('readback_spoken');
    const m2 = new ProposalMachine();
    m2.propose(details, READBACK);
    m2.onAssistantMessage('Which slot works better for you?', false);
    expect(m2.current?.state).toBe('pending');
    expect(readbackMatchScore(READBACK, 'totally different words here')).toBeLessThan(0.3);
  });

  it('another assistant turn between read-back and reply clears it (stray yes)', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, false);
    m.onAssistantMessage('Parking is free on weekends.', false);
    expect(m.current?.state).toBe('cleared');
    expect(await m.onUserTurn('yes', yesJudge)).toBeNull();
    expect(m.authorize(details)).toMatch(/read the booking back/);
  });

  it('a tool call between read-back and reply clears it', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, false);
    m.onToolExecuted('check_trial_slots');
    expect(m.current?.state).toBe('cleared');
  });

  it('an interrupted read-back never counts as delivered', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, true);
    expect(m.current?.state).toBe('cleared');
  });

  it('user speaking before the read-back is delivered clears it', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    expect(await m.onUserTurn('yes', yesJudge)).toBeNull();
    expect(m.current?.state).toBe('cleared');
  });

  it('a no or an unclear reply clears it', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, false);
    expect(await m.onUserTurn('No, the Wednesday one instead', yesJudge)).toBe('no');
    expect(m.current?.state).toBe('cleared');
    const m2 = new ProposalMachine();
    m2.propose(details, READBACK);
    m2.onAssistantMessage(READBACK, false);
    expect(await m2.onUserTurn('wait, is parking free there?', yesJudge)).toBe('other');
    expect(m2.current?.state).toBe('cleared');
  });

  it('a judge failure is treated as not confirmed', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, false);
    const failing: AffirmationJudge = async () => {
      throw new Error('llm down');
    };
    expect(await m.onUserTurn('yes', failing)).toBe('other');
    expect(m.current?.state).toBe('cleared');
  });

  it('changed details after confirmation are refused and a new proposal replaces the old one', async () => {
    const m = new ProposalMachine();
    m.propose(details, READBACK);
    m.onAssistantMessage(READBACK, false);
    await m.onUserTurn('yes', yesJudge);
    expect(m.authorize({ ...details, slotId: 'u8-prospect-2026-11-18-1600' })).toMatch(/different from what you agreed/);
    expect(m.authorize({ ...details, childName: 'Liam' })).toMatch(/different/);
    const second = m.propose({ ...details, slotId: 'u8-prospect-2026-11-18-1600' }, 'Second read-back. Shall I book that?');
    expect(second.proposalId).not.toBe('prop-1');
    expect(m.history.some((e) => e.kind === 'cleared' && e.proposalId === 'prop-1')).toBe(true);
    // The old yes never authorizes the new slot.
    expect(m.authorize({ ...details, slotId: 'u8-prospect-2026-11-18-1600' })).toMatch(/read the booking back/);
  });
});
