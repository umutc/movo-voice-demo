// Per-call provider cost estimate. The meter listens to each model's own `metrics_collected`
// event (STT audio duration, TTS characters, LLM prompt, cached and completion tokens), so every
// use of the session's models counts, including the post-call summary and the affirmation judge,
// which run outside the session pipeline. Prices come from config (resolvePrices); nothing is
// invented: an unpriced model leaves its cost null.
import type { Prices } from './config.ts';
import type { ModelProvider } from './models.ts';

export interface UsageTotals {
  sttAudioMs: number;
  ttsChars: number;
  llmPromptTokens: number;
  llmCachedTokens: number;
  llmCompletionTokens: number;
}

export const EMPTY_USAGE: UsageTotals = { sttAudioMs: 0, ttsChars: 0, llmPromptTokens: 0, llmCachedTokens: 0, llmCompletionTokens: 0 };

/** The part of an STT, LLM or TTS model the meter needs: the `metrics_collected` event. */
export interface MetricsEmitter {
  on(event: 'metrics_collected', listener: (m: never) => void): unknown;
}

interface SttM {
  audioDurationMs?: number;
}
interface TtsM {
  charactersCount?: number;
}
interface LlmM {
  promptTokens?: number;
  promptCachedTokens?: number;
  completionTokens?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export interface UsageMeter {
  totals(): UsageTotals;
}

export function attachUsageMeter(models: { stt: MetricsEmitter; llm: MetricsEmitter; tts: MetricsEmitter }): UsageMeter {
  const t: UsageTotals = { ...EMPTY_USAGE };
  (models.stt.on as (e: 'metrics_collected', l: (m: SttM) => void) => unknown)('metrics_collected', (m) => {
    t.sttAudioMs += num(m?.audioDurationMs);
  });
  (models.tts.on as (e: 'metrics_collected', l: (m: TtsM) => void) => unknown)('metrics_collected', (m) => {
    t.ttsChars += num(m?.charactersCount);
  });
  (models.llm.on as (e: 'metrics_collected', l: (m: LlmM) => void) => unknown)('metrics_collected', (m) => {
    t.llmPromptTokens += num(m?.promptTokens);
    t.llmCachedTokens += num(m?.promptCachedTokens);
    t.llmCompletionTokens += num(m?.completionTokens);
  });
  return { totals: () => ({ ...t }) };
}

export interface CallCost {
  /** Billed through LiveKit Inference (the LiveKit credit) or the owner's provider accounts. */
  provider: ModelProvider;
  deepgram: { usd: number | null; sttMinutes: number; ttsChars: number };
  openai: { usd: number | null; inputTokens: number; cachedTokens: number; outputTokens: number };
  totalUsd: number | null;
  pricesChecked: string;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Cost of one call. OpenAI reports cached tokens as part of the prompt tokens, so the uncached
 * input is prompt minus cached. Deepgram STT bills audio minutes, Aura-2 bills characters.
 */
export function computeCallCost(usage: UsageTotals, prices: Prices, provider: ModelProvider): CallCost {
  const sttMinutes = usage.sttAudioMs / 60_000;
  const cached = Math.min(usage.llmCachedTokens, usage.llmPromptTokens);
  const uncached = usage.llmPromptTokens - cached;
  const stt = prices.sttPerMin === null ? null : sttMinutes * prices.sttPerMin;
  const tts = prices.ttsPer1MChars === null ? null : (usage.ttsChars / 1e6) * prices.ttsPer1MChars;
  const deepgramUsd = stt === null || tts === null ? null : round6(stt + tts);
  const openaiUsd = prices.llm === null ? null : round6((uncached * prices.llm.input + cached * prices.llm.cached + usage.llmCompletionTokens * prices.llm.output) / 1e6);
  return {
    provider,
    deepgram: { usd: deepgramUsd, sttMinutes: round6(sttMinutes), ttsChars: usage.ttsChars },
    openai: { usd: openaiUsd, inputTokens: usage.llmPromptTokens, cachedTokens: cached, outputTokens: usage.llmCompletionTokens },
    totalUsd: deepgramUsd === null || openaiUsd === null ? null : round6(deepgramUsd + openaiUsd),
    pricesChecked: prices.checked,
  };
}

export interface Pipeline {
  stt: string;
  llm: string;
  tts: string;
  /** How the models are reached. Missing on calls recorded before the switch (inference). */
  provider: ModelProvider;
}

/** The model ids recorded in metrics and shown in the UI. The ids are the same in both modes. */
export function pipelineLabels(cfg: { MODEL_PROVIDER: ModelProvider; LK_STT_MODEL: string; LK_LLM_MODEL: string; LK_TTS_MODEL: string }): Pipeline {
  return { stt: cfg.LK_STT_MODEL, llm: cfg.LK_LLM_MODEL, tts: cfg.LK_TTS_MODEL, provider: cfg.MODEL_PROVIDER };
}
