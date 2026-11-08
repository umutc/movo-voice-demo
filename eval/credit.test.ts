// The eval stops on an inference credit error (429) instead of scoring it. Mocked errors only,
// no network: the fake LLMs below never reach LiveKit Inference.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { APIConnectionError, APIStatusError, type llm } from '@livekit/agents';
import { describe, expect, it } from 'vitest';
import { CreditGuard, InferenceCreditExhausted, isCreditError, writeAbortedMarker } from './credit.ts';
import { SimulatedCaller } from './simulated-caller.ts';

function gateway429(): APIStatusError {
  return new APIStatusError({
    message: '429 MaxGatewayCredits',
    options: { statusCode: 429, body: { code: 'MaxGatewayCredits', message: 'gateway credits exhausted, 0 remaining' }, retryable: true },
  });
}

/** An LLM stand-in whose chat stream rejects with `err`. */
function failingLlm(err: unknown): { model: llm.LLM; calls: () => number } {
  let calls = 0;
  const model = {
    chat: () => {
      calls += 1;
      return { collect: () => Promise.reject(err) };
    },
  } as unknown as llm.LLM;
  return { model, calls: () => calls };
}

const persona = { persona: 'A parent of a nine-year-old.', goal: 'Book a trial class.' };

describe('inference credit errors', () => {
  it('classifies 429 and quota errors, not ordinary failures', () => {
    expect(isCreditError(gateway429())).toBe(true);
    // What the SDK throws after its retries: no status left, so the guard reads the error event instead.
    expect(isCreditError(new APIConnectionError({ message: 'failed to generate LLM completion after 4 attempts' }))).toBe(false);
    expect(isCreditError(new Error('wrapped', { cause: gateway429() }))).toBe(true);
    expect(isCreditError(new Error('You exceeded your current quota'))).toBe(true);
    expect(isCreditError(new Error('socket hang up'))).toBe(false);
    expect(isCreditError(new APIStatusError({ message: 'bad gateway', options: { statusCode: 502 } }))).toBe(false);
  });

  it('the simulated caller stops on the first 429 instead of reporting an empty reply', async () => {
    const { model, calls } = failingLlm(gateway429());
    const caller = new SimulatedCaller(model, persona);
    const turn = caller.nextTurn([], { readbackCount: 0, lastAgentIsReadback: false });
    await expect(turn).rejects.toBeInstanceOf(InferenceCreditExhausted);
    await expect(turn).rejects.toThrow(/LiveKit Inference credit exhausted \(429 MaxGatewayCredits, simulated caller\): eval aborted, results are not a score/);
    expect(calls()).toBe(1);
  });

  it('other caller errors keep the old behavior (one retry, then "returned nothing")', async () => {
    const { model, calls } = failingLlm(new Error('socket hang up'));
    const caller = new SimulatedCaller(model, persona);
    await expect(caller.nextTurn([], { readbackCount: 0, lastAgentIsReadback: false })).rejects.toThrow('simulated caller LLM returned nothing');
    expect(calls()).toBe(2);
  });

  it('the guard trips on an LLM error event (the SDK swallows the 429 behind its retries)', () => {
    const judge = new EventEmitter();
    const guard = new CreditGuard().watch(judge as unknown as llm.LLM, 'judge');
    judge.emit('error', { type: 'llm_error', error: new Error('socket hang up'), recoverable: true });
    expect(() => guard.check()).not.toThrow();
    judge.emit('error', { type: 'llm_error', error: gateway429(), recoverable: false });
    expect(() => guard.check()).toThrow(/credit exhausted \(429 MaxGatewayCredits, judge\)/);
  });

  it('writes an aborted marker, not a scorecard', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'eval-credit-')), 'last-run.json');
    writeAbortedMarker(file, new InferenceCreditExhausted('judge', gateway429()), 'core', '2026-11-08');
    const out = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(out).toMatchObject({ aborted: true, pass: false, profile: 'core', scenarios: [] });
    expect(out).not.toHaveProperty('totals');
  });
});
