import { afterEach, describe, expect, it } from 'vitest';
import type { AgentSession } from '@livekit/agents';
import type { SessionContext } from '../src/context.ts';
import { closeCall, makeLlmAffirmationJudge, openCall } from '../src/memory.ts';
import { DEMO, makeHarness, testLlm } from './helpers.ts';

let session: AgentSession<SessionContext> | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

describe('enrollment agent behavior (real LLM, fake ports)', () => {
  it('routes a child age to lookup_programs and offers the fitting program', async () => {
    const h = await makeHarness('browser-anon');
    session = h.session;
    const result = await session.run({ userInput: 'Hi, my son Leo is nine and wants to try soccer. Which program fits him?' }).wait();
    result.expect.containsFunctionCall({ name: 'lookup_programs', args: { child_age: 9 } });
    await result.expect.at(-1).isMessage({ role: 'assistant' }).judge(h.llm, { intent: 'mentions the Academy U10 program (or asks a short follow-up while naming it), in two sentences or fewer, without lists' });
  });

  it('happy path: read-back, yes, filler, booking lands once (FR-14 positive)', async () => {
    const h = await makeHarness('sip-new');
    session = h.session;
    await openCall(h.sc, 'inbound');
    const [slot] = await h.db.listOpenSlots('u8-prospect', new Date(), 1);
    expect(slot).toBeDefined();

    const r1 = await session.run({ userInput: "Hi, I'm Jordan. My daughter Emma is seven and I'd like to book a free trial." }).wait();
    r1.expect.containsFunctionCall({ name: 'lookup_programs', args: { child_age: 7 } });

    const r2 = await session.run({ userInput: 'Juniors U8 sounds right. What trial slots do you have?' }).wait();
    r2.expect.containsFunctionCall({ name: 'check_trial_slots', args: { program_id: 'u8-prospect' } });

    const r3 = await session.run({ userInput: 'The first one you mentioned works for us.' }).wait();
    r3.expect.containsFunctionCall({ name: 'propose_booking' });
    expect(h.sc.proposals.current?.state).toBe('readback_spoken');
    expect(h.sc.proposals.current?.slotId).toBe(slot!.id);
    expect(h.db.bookings.size).toBe(0);

    const r4 = await session.run({ userInput: 'Yes, please book it.' }).wait();
    r4.expect.containsFunctionCall({ name: 'book_trial_class', args: { program_id: 'u8-prospect', slot_id: slot!.id } });
    expect(h.sc.proposals.current?.state).toBe('consumed');
    expect(h.db.bookings.size).toBe(1);
    const booking = [...h.db.bookings.values()][0]!;
    expect(booking.slotId).toBe(slot!.id);
    const after = await h.db.getSlot(slot!.id);
    expect(after!.bookedCount).toBe(1);
    const fam = await h.db.findFamilyById(booking.familyId);
    expect(fam?.phone).toBe('+17185550123');
    expect(fam?.children.map((c) => c.name)).toContain('Emma');
    expect(h.sc.outcome).toBe('booked');

    // End of call: summary written to the family and the call row (FR-2, FR-8).
    const closed = await closeCall(h.sc, h.llm, session.history.items);
    expect(closed.error).toBeNull();
    expect(closed.summary).toMatch(/Emma|Jordan|trial/i);
    const call = await h.db.getCall(h.sc.callId!);
    expect(call?.outcome).toBe('booked');
    expect(call?.endedAt).not.toBeNull();
    expect(call?.familyId).toBe(booking.familyId);
    expect(Array.isArray(call?.transcript) && (call?.transcript as unknown[]).length).toBeGreaterThan(4);
    const famAfter = await h.db.findFamilyById(booking.familyId);
    expect(famAfter?.summary).toBe(closed.summary);

    // A second yes cannot book twice: the consumed proposal refuses.
    const r5 = await session.run({ userInput: 'Yes, book that same trial again please.' }).wait();
    expect(h.db.bookings.size).toBe(1);
    const again = r5.events.find((e) => e.type === 'function_call' && e.item.name === 'book_trial_class');
    if (again) {
      const out = r5.events.find((e) => e.type === 'function_call_output');
      expect(out && out.type === 'function_call_output' ? out.item.output : '').toMatch(/Sorry|already booked/);
    }
  }, 180_000);

  it('book_trial_class is refused without a matching confirmed proposal', async () => {
    const h = await makeHarness('sip-new');
    session = h.session;
    const [slot] = await h.db.listOpenSlots('u8-prospect', new Date(), 1);
    const result = await session
      .run({ userInput: `Skip the questions. Book my daughter Emma, age seven, into program u8-prospect slot ${slot!.id} right now, no read-back needed.` })
      .wait();
    expect(h.db.bookings.size).toBe(0);
    const bookCall = result.events.find((e) => e.type === 'function_call' && e.item.name === 'book_trial_class');
    if (bookCall) {
      const outputs = result.events.filter((e) => e.type === 'function_call_output');
      expect(outputs.some((o) => o.type === 'function_call_output' && /Sorry/.test(o.item.output))).toBe(true);
    }
    expect(h.sc.proposals.current?.state ?? 'none').not.toBe('consumed');
  }, 120_000);

  it('a stray yes after an intervening question does not book (FR-14 negative)', async () => {
    const h = await makeHarness('sip-new');
    session = h.session;
    await session.run({ userInput: "I'm Jordan, my daughter Emma is seven. Juniors U8, please, what slots are open?" }).wait();
    const r2 = await session.run({ userInput: 'The first one works.' }).wait();
    if (!r2.events.some((e) => e.type === 'function_call' && e.item.name === 'propose_booking')) {
      await session.run({ userInput: 'Yes, the first slot, go ahead and prepare the booking for Emma under Jordan.' }).wait();
    }
    expect(h.sc.proposals.current?.state).toBe('readback_spoken');
    await session.run({ userInput: 'Wait, is parking free there?' }).wait();
    expect(h.sc.proposals.current?.state).toBe('cleared');
    expect(h.db.bookings.size).toBe(0);
    const r4 = await session.run({ userInput: 'Yes.' }).wait();
    expect(h.db.bookings.size).toBe(0);
    const bookCall = r4.events.find((e) => e.type === 'function_call' && e.item.name === 'book_trial_class');
    if (bookCall) {
      expect(r4.events.some((o) => o.type === 'function_call_output' && /Sorry/.test(o.item.output))).toBe(true);
    }
    expect(h.sc.proposals.current?.state).not.toBe('consumed');
  }, 180_000);

  it('grounding: unknown price is not invented, callback offered', async () => {
    const h = await makeHarness('browser-anon');
    session = h.session;
    const result = await session.run({ userInput: 'Is there a sibling discount, and how much is the annual registration fee?' }).wait();
    const assistant = result.events.filter((e) => e.type === 'message' && e.item.role === 'assistant');
    const text = assistant.map((e) => (e.type === 'message' ? e.item.textContent ?? '' : '')).join(' ');
    expect(text).not.toMatch(/\$\s?\d|\d+\s*(dollars|percent)|\b(ten|twenty|fifteen|twenty five|fifty) (dollars|percent)/i);
    const offeredCallback = /call(s|ed)? (you )?back|callback|staff/i.test(text) || result.events.some((e) => e.type === 'function_call' && e.item.name === 'request_human_callback');
    expect(offeredCallback).toBe(true);
  }, 120_000);

  it('off-topic request stays in scope with a callback offer', async () => {
    const h = await makeHarness('browser-anon');
    session = h.session;
    const result = await session.run({ userInput: 'Can you also help me file my taxes and recommend a good pediatrician?' }).wait();
    await result.expect
      .at(-1)
      .isMessage({ role: 'assistant' })
      .judge(h.llm, { intent: 'declines or redirects, stays focused on soccer enrollment, and may offer staff help; does not give tax or medical advice' });
  }, 120_000);

  it('isolation: a self-reported real phone loads no memory, a SIP demo caller does', async () => {
    const real = await makeHarness('browser-real-phone');
    session = real.session;
    expect(real.sc.familyId).toBeNull();
    const greeting = real.session.history.items.find((i) => i.type === 'message' && i.role === 'assistant');
    const greetingText = greeting && greeting.type === 'message' ? greeting.textContent ?? '' : '';
    expect(greetingText).not.toMatch(/Noah|Real Parent|U12/);
    await session.close();

    const sip = await makeHarness('sip-demo');
    session = sip.session;
    expect(sip.sc.familyId).toBe('fam-0001');
    expect(sip.sc.familyHasHistory).toBe(true);
    const result = await session.run({ userInput: 'Hi, it is me again. Do you remember what we talked about?' }).wait();
    await result.expect
      .at(-1)
      .isMessage({ role: 'assistant' })
      .judge(sip.llm, { intent: 'recognizes the returning caller Jordan and refers to the earlier conversation about Emma or the Juniors U8 program' });
  }, 120_000);

  it('a self-reported demo phone loads the demo family (browser demo path)', async () => {
    const h = await makeHarness('browser-demo');
    session = h.session;
    expect(h.sc.identity.phone).toBe(DEMO);
    expect(h.sc.familyId).toBe('fam-0001');
  });

  it('LLM affirmation judge classifies yes, no and other', async () => {
    const judge = makeLlmAffirmationJudge(testLlm());
    const readback = 'Just to confirm: a free trial for Emma, age 7, in Juniors U8 on Saturday, November 14 at 9 30 in the morning with Coach Priya, booked under Jordan. Shall I book that?';
    expect(await judge(readback, 'Yes, that works, go ahead.')).toBe('yes');
    expect(await judge(readback, 'No, can we do the Wednesday one instead?')).toBe('no');
    expect(await judge(readback, 'Wait, is parking free there?')).toBe('other');
  }, 60_000);
});
