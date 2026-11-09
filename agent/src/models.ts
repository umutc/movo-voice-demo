// Model factory for the provider switch (MODEL_PROVIDER). One set of model ids (LK_STT_MODEL,
// LK_LLM_MODEL, LK_TTS_MODEL, in the LiveKit Inference `provider/model[:voice]` format) names the
// models in both modes:
// - inference: LiveKit Inference, billed to the LiveKit Cloud credit through LIVEKIT_API_KEY.
// - direct: the Deepgram and OpenAI plugins (@livekit/agents-plugin-deepgram and -openai, pinned
//   to the core version), billed to the owner's own Deepgram and OpenAI accounts.
// VAD and the turn detector are not part of the switch: they stay on the SDK's inference classes
// (turn detection and adaptive interruption are free for agents hosted on LiveKit Cloud).
import { inference, type llm, type stt, type tts } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import { splitTtsModel } from './config.ts';

export type ModelProvider = 'inference' | 'direct';

/** `openai/gpt-6.1-terra` -> `gpt-6.1-terra`. Direct mode supports OpenAI models only. */
export function openaiModelId(id: string): string {
  const [vendor, model] = splitVendor(id);
  if (vendor !== 'openai' || !model) throw new Error(`MODEL_PROVIDER=direct needs an openai/* LLM id, got "${id}"`);
  return model;
}

/** `deepgram/nova-3` -> `nova-3`. Direct mode supports Deepgram STT only. */
export function deepgramSttModel(id: string): string {
  const [vendor, model] = splitVendor(id);
  if (vendor !== 'deepgram' || !model) throw new Error(`MODEL_PROVIDER=direct needs a deepgram/* STT id, got "${id}"`);
  return model;
}

/**
 * `deepgram/aura-2:athena` -> `aura-2-athena-en`, Deepgram's own model name for the same voice.
 * Direct mode supports Deepgram Aura-2 TTS only, and a voice is required.
 */
export function deepgramTtsModel(id: string): string {
  const { model, voice } = splitTtsModel(id);
  const [vendor, family] = splitVendor(model);
  if (vendor !== 'deepgram' || family !== 'aura-2' || !voice) {
    throw new Error(`MODEL_PROVIDER=direct needs a deepgram/aura-2:<voice> TTS id, got "${id}"`);
  }
  return `aura-2-${voice}-en`;
}

function splitVendor(id: string): [string, string] {
  const idx = id.indexOf('/');
  return idx === -1 ? ['', id] : [id.slice(0, idx), id.slice(idx + 1)];
}

/** One LLM for the given id and provider. Used by the agent, the behavior tests and the eval. */
export function makeLlm(id: string, provider: ModelProvider, openaiApiKey?: string): llm.LLM {
  if (provider === 'direct') {
    // reasoning_effort 'none': on /v1/chat/completions the gpt-6 models reject function tools
    // unless reasoning is off ("Function tools with reasoning_effort are not supported"). The
    // plugin's own default list stops at gpt-5.6, so it sends nothing and the server default
    // applies. LiveKit Inference sets this for us; direct calls must set it explicitly.
    // parallelToolCalls false: the plugin defaults to true, and two propose_booking calls in one
    // turn made the agent read one booking back while the other proposal was current. A voice
    // agent proposes one booking per turn.
    return new openai.LLM({ model: openaiModelId(id), reasoningEffort: 'none', parallelToolCalls: false, ...(openaiApiKey ? { apiKey: openaiApiKey } : {}) });
  }
  return new inference.LLM({ model: id as inference.LLMModels });
}

/** MODEL_PROVIDER from an env map; anything but `direct` means inference. */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): ModelProvider {
  return env.MODEL_PROVIDER?.trim() === 'direct' ? 'direct' : 'inference';
}

export interface ModelSet {
  provider: ModelProvider;
  stt: stt.STT;
  llm: llm.LLM;
  tts: tts.TTS;
}

export interface ModelConfig {
  MODEL_PROVIDER: ModelProvider;
  LK_STT_MODEL: string;
  LK_LLM_MODEL: string;
  LK_TTS_MODEL: string;
  DEEPGRAM_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

/** STT, LLM and TTS for the session, from the configured provider. Keys come from config, never logged. */
export function buildModels(cfg: ModelConfig): ModelSet {
  if (cfg.MODEL_PROVIDER === 'direct') {
    return {
      provider: 'direct',
      stt: new deepgram.STT({ model: deepgramSttModel(cfg.LK_STT_MODEL), language: 'en', ...(cfg.DEEPGRAM_API_KEY ? { apiKey: cfg.DEEPGRAM_API_KEY } : {}) }),
      llm: makeLlm(cfg.LK_LLM_MODEL, 'direct', cfg.OPENAI_API_KEY),
      tts: new deepgram.TTS({ model: deepgramTtsModel(cfg.LK_TTS_MODEL), ...(cfg.DEEPGRAM_API_KEY ? { apiKey: cfg.DEEPGRAM_API_KEY } : {}) }),
    };
  }
  const t = splitTtsModel(cfg.LK_TTS_MODEL);
  return {
    provider: 'inference',
    stt: new inference.STT({ model: cfg.LK_STT_MODEL as inference.STTModels, language: 'en' }),
    llm: makeLlm(cfg.LK_LLM_MODEL, 'inference'),
    tts: new inference.TTS({ model: t.model as inference.TTSModels, ...(t.voice ? { voice: t.voice } : {}), language: 'en' }),
  };
}
