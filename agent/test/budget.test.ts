// Provider switch, cost math, budget alerts, the Deepgram balance check and the provider error
// shapes of the direct plugins. Fakes and a mocked fetch only: no model, no SNS, no database, no network.
import { EventEmitter } from 'node:events';
import { APIStatusError, APIConnectionError } from '@livekit/agents';
import { Alerter, FakeAlertPort } from 'db/alerts';
import { FakeOps } from 'db/ops';
import { describe, expect, it } from 'vitest';
import { budgetAlertsDue, DeepgramBalance, MONTH_MS, runPostCallBudget, type PostCallInput } from '../src/budget.ts';
import { loadConfig, resolvePrices } from '../src/config.ts';
import { attachUsageMeter, computeCallCost, EMPTY_USAGE } from '../src/cost.ts';
import { deepgramSttModel, deepgramTtsModel, openaiModelId } from '../src/models.ts';
import { classifyProviderError, isCreditError } from '../src/provider-errors.ts';

const HOUR = 3_600_000;
const quiet = { info: () => {}, warn: () => {} };
const BASE_ENV = { LIVEKIT_URL: 'wss://x.livekit.cloud', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', DATABASE_URL: 'postgres://u:p@h:6543/db' };

const cfg = (over: Partial<PostCallInput['cfg']> = {}): PostCallInput['cfg'] => ({
  MODEL_PROVIDER: 'direct',
  LK_STT_MODEL: 'deepgram/nova-3',
  LK_LLM_MODEL: 'openai/gpt-6.1-terra',
  LK_TTS_MODEL: 'deepgram/aura-2:athena',
  OPENAI_BUDGET_USD: 5,
  DEEPGRAM_BUDGET_USD: 200,
  ...over,
});

describe('MODEL_PROVIDER config', () => {
  it('defaults to inference and needs no provider keys there', () => {
    const c = loadConfig(BASE_ENV);
    expect(c.MODEL_PROVIDER).toBe('inference');
    expect(c.OPENAI_BUDGET_USD).toBe(5);
    expect(c.DEEPGRAM_BUDGET_USD).toBe(200);
  });

  it('direct requires both provider keys and names only the missing ones', () => {
    expect(() => loadConfig({ ...BASE_ENV, MODEL_PROVIDER: 'direct', OPENAI_API_KEY: 'x' })).toThrow('MODEL_PROVIDER=direct requires DEEPGRAM_API_KEY in .env');
    expect(loadConfig({ ...BASE_ENV, MODEL_PROVIDER: 'direct', OPENAI_API_KEY: 'x', DEEPGRAM_API_KEY: 'y' }).MODEL_PROVIDER).toBe('direct');
    expect(() => loadConfig({ ...BASE_ENV, MODEL_PROVIDER: 'other' })).toThrow(/MODEL_PROVIDER/);
  });

  it('maps the LiveKit Inference ids to the provider model names', () => {
    expect(openaiModelId('openai/gpt-6.1-terra')).toBe('gpt-6.1-terra');
    expect(deepgramSttModel('deepgram/nova-3')).toBe('nova-3');
    expect(deepgramTtsModel('deepgram/aura-2:athena')).toBe('aura-2-athena-en');
    expect(() => deepgramTtsModel('cartesia/sonic-3:abc')).toThrow(/deepgram\/aura-2/);
    expect(() => openaiModelId('google/gemma-4-31b-it')).toThrow(/openai/);
  });
});

describe('cost math', () => {
  it('prices from the dated table, env overrides win', () => {
    const p = resolvePrices(cfg());
    expect(p).toMatchObject({ sttPerMin: 0.0048, ttsPer1MChars: 30, llm: { input: 1, cached: 0.05, output: 5 } });
    expect(resolvePrices(cfg({ LK_LLM_MODEL: 'openai/gpt-6-luna' })).llm).toEqual({ input: 0.1, cached: 0.01, output: 0.5 });
    expect(resolvePrices(cfg({ PRICE_LLM_INPUT_PER_1M: 2, PRICE_STT_PER_MIN: 0.0043 }))).toMatchObject({ sttPerMin: 0.0043, llm: { input: 2, cached: 0.05, output: 5 } });
    expect(resolvePrices(cfg({ LK_LLM_MODEL: 'openai/unknown' })).llm).toBeNull();
  });

  it('cached tokens are part of the prompt tokens and priced at the cached rate', () => {
    const usage = { sttAudioMs: 90_000, ttsChars: 2_000, llmPromptTokens: 40_000, llmCachedTokens: 30_000, llmCompletionTokens: 1_000 };
    const c = computeCallCost(usage, resolvePrices(cfg()), 'direct');
    // STT 1.5 min * 0.0048 = 0.0072; TTS 2000 / 1M * 30 = 0.06
    expect(c.deepgram).toEqual({ usd: 0.0672, sttMinutes: 1.5, ttsChars: 2000 });
    // 10k uncached * 1.00 + 30k cached * 0.05 + 1k output * 5.00, per 1M = 0.01 + 0.0015 + 0.005
    expect(c.openai).toEqual({ usd: 0.0165, inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 1_000 });
    expect(c.totalUsd).toBe(0.0837);
  });

  it('an unpriced model leaves its cost null instead of guessing', () => {
    const c = computeCallCost({ ...EMPTY_USAGE, llmPromptTokens: 10 }, resolvePrices(cfg({ LK_LLM_MODEL: 'openai/unknown' })), 'direct');
    expect(c.openai.usd).toBeNull();
    expect(c.totalUsd).toBeNull();
  });

  it('the meter sums each model metrics_collected event', () => {
    const stt = new EventEmitter();
    const llm = new EventEmitter();
    const tts = new EventEmitter();
    const meter = attachUsageMeter({ stt, llm, tts } as unknown as Parameters<typeof attachUsageMeter>[0]);
    stt.emit('metrics_collected', { type: 'stt_metrics', audioDurationMs: 5_000 });
    stt.emit('metrics_collected', { type: 'stt_metrics', audioDurationMs: 2_500 });
    tts.emit('metrics_collected', { type: 'tts_metrics', charactersCount: 120 });
    llm.emit('metrics_collected', { type: 'llm_metrics', promptTokens: 900, promptCachedTokens: 600, completionTokens: 40 });
    llm.emit('metrics_collected', { type: 'llm_metrics', promptTokens: 100, promptCachedTokens: 0, completionTokens: 10 });
    expect(meter.totals()).toEqual({ sttAudioMs: 7_500, ttsChars: 120, llmPromptTokens: 1_000, llmCachedTokens: 600, llmCompletionTokens: 50 });
  });
});

function setup(opts: { now?: Date } = {}) {
  const port = new FakeAlertPort();
  const ops = new FakeOps();
  let now = opts.now ?? new Date('2026-11-09T12:00:00Z');
  const alerter = new Alerter({ port, log: ops, cooldownMs: 6 * HOUR, logger: () => {}, throttle: new Map(), now: () => now });
  const subjects = () => port.sent.map((m) => m.subject.replace('[movo-voice-demo] ', ''));
  return { port, ops, alerter, subjects, setNow: (d: Date) => (now = d), now: () => now };
}

/** Usage that costs exactly `usd` on OpenAI at gpt-6.1-terra output prices (5.00 per 1M). */
const openaiUsd = (usd: number) => ({ ...EMPTY_USAGE, llmCompletionTokens: Math.round((usd / 5) * 1e6) });

describe('budget alerts', () => {
  it('thresholds: 50 and 80 percent per provider', () => {
    expect(budgetAlertsDue({ openai: 2.4, deepgram: 0 }, { openai: 5, deepgram: 200 })).toEqual([]);
    expect(budgetAlertsDue({ openai: 2.5, deepgram: 0 }, { openai: 5, deepgram: 200 }).map((d) => d.kind)).toEqual(['budget_openai_50']);
    expect(budgetAlertsDue({ openai: 4.2, deepgram: 161 }, { openai: 5, deepgram: 200 }).map((d) => d.kind)).toEqual(['budget_openai_50', 'budget_openai_80', 'budget_deepgram_50', 'budget_deepgram_80']);
  });

  it('records one spend row per call and provider, and alerts once per threshold per month', async () => {
    const h = setup();
    const run = (callId: string, usd: number) => runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId, usage: openaiUsd(usd), now: h.now(), balance: null });
    let r = await run('c1', 1.0);
    expect(r.monthSpend?.openai).toBeCloseTo(1.0, 6);
    expect(h.subjects()).toEqual([]);
    r = await run('c2', 1.6);
    expect(r.alerts).toEqual(['budget_openai_50:sent']);
    r = await run('c3', 0.5);
    expect(r.alerts).toEqual(['budget_openai_50:duplicate']);
    r = await run('c4', 1.0);
    expect(r.alerts).toEqual(['budget_openai_50:duplicate', 'budget_openai_80:sent']);
    // Same call id again (a retried finalize) does not count twice.
    r = await run('c4', 1.0);
    expect(r.monthSpend?.openai).toBeCloseTo(4.1, 6);
    expect(h.subjects()).toEqual(['budget_openai_50', 'budget_openai_80']);
    expect(h.ops.spend.filter((s) => s.provider === 'openai')).toHaveLength(4);
  });

  it('a new month starts from zero and alerts again', async () => {
    const h = setup();
    await runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: 'a', usage: openaiUsd(3), now: h.now(), balance: null });
    h.setNow(new Date('2026-12-01T00:05:00Z'));
    let r = await runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: 'b', usage: openaiUsd(1), now: h.now(), balance: null });
    expect(r.monthSpend?.openai).toBeCloseTo(1, 6);
    expect(r.alerts).toEqual([]);
    r = await runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: 'c', usage: openaiUsd(2), now: h.now(), balance: null });
    expect(r.alerts).toEqual(['budget_openai_50:sent']);
    expect(h.ops.alerts.map((a) => a.kind)).toEqual(['budget_openai_50:2026-11', 'budget_openai_50:2026-12']);
    expect(MONTH_MS).toBeGreaterThan(31 * 24 * HOUR);
  });

  it('inference mode estimates the cost but records no spend and sends no budget alert', async () => {
    const h = setup();
    const r = await runPostCallBudget({ cfg: cfg({ MODEL_PROVIDER: 'inference' }), ops: h.ops, alerter: h.alerter, logger: quiet, callId: 'x', usage: openaiUsd(9), now: h.now(), balance: { usd: async () => 1 } });
    expect(r.cost?.provider).toBe('inference');
    expect(h.ops.spend).toEqual([]);
    expect(r.balanceUsd).toBeNull();
    expect(h.port.sent).toEqual([]);
  });

  it('never throws: a database outage is reported, and a hanging step is cut off by the timeout', async () => {
    const h = setup();
    h.ops.down = true;
    const r = await runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: 'x', usage: openaiUsd(1), now: h.now(), balance: null });
    expect(r.error).toMatch(/^spend: database unreachable/);
    h.ops.down = false;
    const started = Date.now();
    const slow = await runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: 'y', usage: EMPTY_USAGE, now: h.now(), balance: { usd: () => new Promise(() => {}) }, timeoutMs: 50 });
    expect(slow.error).toMatch(/timed out after 50 ms/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('Deepgram balance', () => {
  function mockFetch(balance: number | null, status = 200) {
    const calls: string[] = [];
    const fetch = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(`${url} ${init.headers.Authorization === 'Token billing-key' ? 'auth-ok' : 'auth-missing'}`);
      if (status !== 200) return { ok: false, status, json: async () => ({}) };
      if (url.endsWith('/projects')) return { ok: true, status, json: async () => ({ projects: [{ project_id: 'p-1', name: 'demo' }] }) };
      return { ok: true, status, json: async () => ({ balances: balance === null ? [] : [{ balance_id: 'b', amount: balance, units: 'usd' }] }) };
    };
    return { fetch, calls };
  }

  it('reads the project once, then the balance, with the billing key in the header', async () => {
    const m = mockFetch(187.25);
    const reader = new DeepgramBalance('billing-key', { fetch: m.fetch });
    expect(await reader.usd()).toBe(187.25);
    expect(await reader.usd()).toBe(187.25);
    expect(m.calls).toEqual([
      'https://api.deepgram.com/v1/projects auth-ok',
      'https://api.deepgram.com/v1/projects/p-1/balances auth-ok',
      'https://api.deepgram.com/v1/projects/p-1/balances auth-ok',
    ]);
  });

  it('HTTP errors and a missing USD amount throw (the post-call run catches them)', async () => {
    await expect(new DeepgramBalance('billing-key', { fetch: mockFetch(1, 403).fetch }).usd()).rejects.toThrow('Deepgram /projects answered HTTP 403');
    await expect(new DeepgramBalance('billing-key', { fetch: mockFetch(null).fetch }).usd()).rejects.toThrow(/no USD amount/);
  });

  it('alerts below 50 and below 10 once a month, pauses below 2 with a clear reason', async () => {
    const h = setup();
    const run = async (balance: number) =>
      runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: null, usage: EMPTY_USAGE, now: h.now(), balance: new DeepgramBalance('billing-key', { fetch: mockFetch(balance).fetch }) });
    let r = await run(120);
    expect(r).toMatchObject({ balanceUsd: 120, alerts: [], paused: false });
    r = await run(49.5);
    expect(r.alerts).toEqual(['deepgram_balance_50:sent']);
    r = await run(45);
    expect(r.alerts).toEqual(['deepgram_balance_50:duplicate']);
    r = await run(9.9);
    expect(r.alerts).toEqual(['deepgram_balance_50:duplicate', 'deepgram_balance_10:sent']);
    expect((await h.ops.getDemoState()).paused).toBe(false);
    r = await run(1.75);
    expect(r.paused).toBe(true);
    expect(r.alerts).toContain('deepgram_balance_2:sent');
    expect(await h.ops.getDemoState()).toMatchObject({ paused: true, reason: 'deepgram_balance: 1.75 USD left (below 2)' });
    expect(h.subjects()).toEqual(['deepgram_balance_50', 'deepgram_balance_10', 'deepgram_balance_2']);
  });

  it('a failed balance read does not pause and does not throw', async () => {
    const h = setup();
    const r = await runPostCallBudget({ cfg: cfg(), ops: h.ops, alerter: h.alerter, logger: quiet, callId: null, usage: EMPTY_USAGE, now: h.now(), balance: new DeepgramBalance('billing-key', { fetch: mockFetch(1, 500).fetch }) });
    expect(r.error).toMatch(/^balance: Deepgram \/projects answered HTTP 500/);
    expect(r.paused).toBe(false);
  });
});

describe('direct provider error shapes (from the 1.9.5 plugin sources)', () => {
  it('OpenAI insufficient_quota (429) pauses even while the SDK would still retry', () => {
    const err = new APIStatusError({
      message: '429 You exceeded your current quota, please check your plan and billing details.',
      options: { statusCode: 429, body: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' }, retryable: true },
    });
    expect(classifyProviderError(err, true)).toEqual({ kind: 'credit', detail: '429 insufficient_quota' });
    expect(isCreditError(err)).toBe(true);
  });

  it('OpenAI plain rate limit (429, retryable) does not pause', () => {
    const err = new APIStatusError({ message: '429 Rate limit reached for requests', options: { statusCode: 429, body: { code: 'rate_limit_exceeded' } } });
    expect(classifyProviderError(err, true)).toBeNull();
  });

  it('Deepgram 402 from the STT WebSocket, the TTS WebSocket and the TTS REST path', () => {
    const stt = new APIStatusError({ message: 'Deepgram WebSocket connection rejected with status 402', options: { statusCode: 402 } });
    const ttsWs = new Error('Unexpected server response: 402');
    const ttsRest = new Error('Deepgram TTS HTTP request failed: 402 Payment Required');
    for (const err of [stt, ttsWs, ttsRest]) {
      expect(classifyProviderError(err, true)).toEqual({ kind: 'credit', detail: '402 payment required' });
      expect(isCreditError(err)).toBe(true);
    }
  });

  it('Deepgram 401 and 403 count as auth errors; a dropped socket does not pause', () => {
    expect(classifyProviderError(new Error('Unexpected server response: 401'))).toEqual({ kind: 'auth', detail: '401 unauthorized' });
    expect(classifyProviderError(new APIStatusError({ message: 'Deepgram WebSocket connection rejected with status 403', options: { statusCode: 403 } }))).toEqual({ kind: 'auth', detail: '403 forbidden' });
    expect(classifyProviderError(new APIConnectionError({ message: 'Deepgram WebSocket closed unexpectedly' }))).toBeNull();
    expect(classifyProviderError(new Error('Deepgram TTS HTTP request failed: 500 Internal Server Error'))).toBeNull();
  });
});
