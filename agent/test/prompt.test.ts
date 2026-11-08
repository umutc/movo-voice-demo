import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, wordCount } from '../src/prompt.ts';

const base = {
  academyName: 'Brooklyn Youth Soccer Academy',
  personaName: 'Maya',
  now: new Date('2026-11-07T15:00:00Z'),
};

describe('system prompt', () => {
  it('inbound prompt snapshot', () => {
    const text = buildSystemPrompt({ ...base, variant: 'inbound' });
    expect(text).toMatchSnapshot();
  });

  it('follow-up prompt with memory snapshot', () => {
    const text = buildSystemPrompt({
      ...base,
      variant: 'follow_up',
      memory: {
        guardianName: 'Jordan Demo',
        summary: 'Jordan asked about Juniors U8 for Emma.',
        children: [{ name: 'Emma', age: 7 }],
        lastBooking: null,
        lastCallAt: new Date('2026-11-04T18:30:00Z'),
      },
      features: { sms: true, guardian: true },
    });
    expect(text).toMatchSnapshot();
  });

  it('stays under 600 words in every variant', () => {
    for (const variant of ['inbound', 'follow_up'] as const) {
      const text = buildSystemPrompt({
        ...base,
        variant,
        memory: { guardianName: 'Jordan Demo', summary: 'A short summary.', children: [{ name: 'Emma', age: 7 }], lastBooking: null, lastCallAt: base.now },
        features: { sms: true, guardian: true },
      });
      expect(wordCount(text)).toBeLessThan(600);
    }
  });

  it('carries the voice rules, grounding, read-back and closing rules', () => {
    const text = buildSystemPrompt({ ...base, variant: 'inbound' });
    expect(text).toMatch(/at most two short sentences/);
    expect(text).toMatch(/one question per reply/i);
    expect(text).toMatch(/Never use lists, bullet points, markdown/);
    expect(text).toMatch(/numbers, prices, dates, and times in words/);
    expect(text).toMatch(/only from tool results/);
    expect(text).toMatch(/propose_booking before book_trial_class/);
    expect(text).toMatch(/A yes to any other question does not count/);
    expect(text).toMatch(/AI assistant/);
    expect(text).toMatch(/end_call/);
    expect(text).toMatch(/New York/);
    expect(text).not.toMatch(/—/);
  });

  it('omits consent text unless a stretch feature is on, and memory unless present', () => {
    const plain = buildSystemPrompt({ ...base, variant: 'inbound' });
    expect(plain).not.toMatch(/Consent\./);
    expect(plain).not.toMatch(/What you remember/);
    const withSms = buildSystemPrompt({ ...base, variant: 'inbound', features: { sms: true, guardian: false } });
    expect(withSms).toMatch(/text message confirmation/);
    expect(withSms).not.toMatch(/second guardian/);
  });

  it('renders the memory block with New York times', () => {
    const text = buildSystemPrompt({
      ...base,
      variant: 'inbound',
      memory: {
        guardianName: 'Jordan Demo',
        summary: 'Discussed U8.',
        children: [{ name: 'Emma', age: 7 }],
        lastBooking: { childName: 'Emma', programName: 'Juniors U8', startsAt: new Date('2026-11-14T19:00:00Z') },
        lastCallAt: null,
      },
    });
    expect(text).toMatch(/Guardian name: Jordan Demo/);
    expect(text).toMatch(/Emma, age 7/);
    expect(text).toMatch(/Juniors U8 on Saturday, November 14.*2:00 PM/);
  });
});
