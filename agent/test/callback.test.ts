// Callback number confirmation (eval scenario 8): the agent reads the number back and logs the
// callback only after the caller agrees in a later turn. Real LLM, fake ports.
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentSession, voice } from '@livekit/agents';
import type { SessionContext } from '../src/context.ts';
import { makeHarness } from './helpers.ts';

let session: AgentSession<SessionContext> | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

type RunEvents = voice.testing.RunResult['events'];

function callbackCalls(events: RunEvents) {
  return events.filter((e) => e.type === 'function_call' && e.item.name === 'request_human_callback');
}

function assistantText(events: RunEvents): string {
  return events
    .filter((e) => e.type === 'message' && e.item.role === 'assistant')
    .map((e) => (e.type === 'message' ? (e.item.textContent ?? '') : ''))
    .join(' ');
}

describe('callback number confirmation (real LLM, fake ports)', () => {
  it('a garbled number leads to a re-ask, never an immediate callback', async () => {
    const h = await makeHarness('browser-anon');
    session = h.session;
    const result = await session
      .run({ userInput: 'Hi, can someone call me back about registration for next season? My number is seven one eight, five five five, uh, something, four two.' })
      .wait();
    expect(callbackCalls(result.events)).toHaveLength(0);
    expect(h.db.callbacks.size).toBe(0);
    await result.expect
      .at(-1)
      .isMessage({ role: 'assistant' })
      .judge(h.llm, { intent: 'asks the caller to repeat or give the full phone number, or reads back only the digits it heard and asks for the missing ones; does not say a callback was logged and does not invent missing digits' });
  }, 120_000);

  it('a clear number is read back, and the callback is logged with it only after a yes', async () => {
    const h = await makeHarness('browser-anon');
    session = h.session;
    const r1 = await session
      .run({ userInput: 'Hi, can someone from the academy call me back about registration for next season? My number is seven one eight, five five five, zero one four two.' })
      .wait();
    expect(callbackCalls(r1.events)).toHaveLength(0);
    expect(h.db.callbacks.size).toBe(0);
    expect(assistantText(r1.events).toLowerCase()).toMatch(/zero one four two|0142/);

    const r2 = await session.run({ userInput: "Yes, that's right." }).wait();
    expect(callbackCalls(r2.events)).toHaveLength(1);
    const [cb] = [...h.db.callbacks.values()];
    expect(cb?.phone).toBe('+17185550142');
    expect(assistantText(r2.events)).not.toMatch(/business day|within (a|one|two|\d+) (hour|day)/i);
  }, 180_000);

  it('a phone caller confirms the caller id by its last four digits, without the full number read aloud', async () => {
    const h = await makeHarness('sip-new');
    session = h.session;
    const r1 = await session.run({ userInput: 'Hi, I have a question about your refund policy. Can someone from the staff call me back?' }).wait();
    expect(callbackCalls(r1.events)).toHaveLength(0);
    const asked = assistantText(r1.events).toLowerCase();
    expect(asked).toMatch(/zero one two three|0123/);
    expect(asked).not.toMatch(/seven one eight|718/);

    const r2 = await session.run({ userInput: 'Yes, that number is fine.' }).wait();
    expect(callbackCalls(r2.events)).toHaveLength(1);
    const [cb] = [...h.db.callbacks.values()];
    expect(cb?.phone).toBe('+17185550123');
  }, 180_000);
});
