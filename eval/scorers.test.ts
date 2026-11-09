// Grounding scorer: the caller-id last four digits the prompt gives the agent count as grounded.
// Style scorer: an exclamation mark in agent speech is a style problem.
import { describe, expect, it } from 'vitest';
import type { HarnessResult } from './harness.ts';
import { scoreGrounding, scoreStyle } from './scorers.ts';

function result(callerIdText: string, agentText = 'Is the number you are calling from, ending in zero one two three, the right one?'): HarnessResult {
  return {
    run: { timeline: [{ kind: 'assistant', text: agentText }] },
    transcript: [],
    memoryText: '',
    callerIdText,
    finalState: { bookings: 0, callbacks: 0, smsSent: 0 },
    error: null,
  } as unknown as HarnessResult;
}

describe('scoreGrounding', () => {
  it('counts the caller-id last four as grounded, and only when the agent was given them', () => {
    expect(scoreGrounding(result('zero one two three')).score).toBe(1);
    expect(scoreGrounding(result('')).ungrounded).toEqual(['number 0', 'number 2', 'number 3']);
  });
});

describe('scoreStyle', () => {
  it('flags an exclamation mark in agent speech', () => {
    expect(scoreStyle(result('', 'Thanks for calling, goodbye.')).pass).toBe(true);
    const bad = scoreStyle(result('', 'Thanks for calling, goodbye!'));
    expect(bad.pass).toBe(false);
    expect(bad.problems).toContain('exclamation mark');
  });
});
