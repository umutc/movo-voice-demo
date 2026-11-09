import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Env parsing for the agent worker and scripts. Secrets live in .env (gitignored); this module
// never logs values. Feature flags gate the Twilio credentials: they are validated only when the
// matching flag is on (CLAUDE.md hard rule 7).

const bool = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'must be E.164, e.g. +12125551234');

const baseSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  AGENT_NAME: z.string().min(1).default('enroll-agent'),

  // inference: STT, LLM and TTS through LiveKit Inference (LIVEKIT_API_KEY, Build-plan credit).
  // direct: the same models through the Deepgram and OpenAI plugins, billed to the owner's own
  // provider accounts. The LK_* ids below name the models in both modes (see agent/src/models.ts).
  MODEL_PROVIDER: z.enum(['inference', 'direct']).default('inference'),
  DEEPGRAM_API_KEY: z.string().optional(),
  // Scope billing:read only: the post-call balance check (agent/src/budget.ts). Optional.
  DEEPGRAM_BILLING_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  // Monthly budgets for the budget alerts (50 and 80 percent of the month-to-date cost estimate).
  OPENAI_BUDGET_USD: z.coerce.number().positive().default(5),
  DEEPGRAM_BUDGET_USD: z.coerce.number().positive().default(200),

  // Price overrides for the per-call cost estimate (USD). Unset means the dated defaults in
  // PRICE_TABLE below for the configured models.
  PRICE_STT_PER_MIN: z.coerce.number().min(0).optional(),
  PRICE_TTS_PER_1M_CHARS: z.coerce.number().min(0).optional(),
  PRICE_LLM_INPUT_PER_1M: z.coerce.number().min(0).optional(),
  PRICE_LLM_CACHED_PER_1M: z.coerce.number().min(0).optional(),
  PRICE_LLM_OUTPUT_PER_1M: z.coerce.number().min(0).optional(),

  LK_STT_MODEL: z.string().min(1).default('deepgram/nova-3'),
  LK_LLM_MODEL: z.string().min(1).default('openai/gpt-6.1-terra'),
  LK_TTS_MODEL: z.string().min(1).default('deepgram/aura-2:athena'),

  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url().optional(),
  TEST_DATABASE_URL: z.string().url().optional(),

  BRAINTRUST_API_KEY: z.string().optional(),
  BRAINTRUST_PROJECT: z.string().min(1).default('movo-voice-demo'),

  // No SMS tool exists yet: agent.ts keeps SMS off in the prompt even when this flag is on.
  FEATURE_SMS: bool,
  FEATURE_OUTBOUND: bool,

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_SIP_TERMINATION_URI: z.string().optional(),
  TWILIO_SIP_USERNAME: z.string().optional(),
  TWILIO_SIP_PASSWORD: z.string().optional(),
  LK_OUTBOUND_TRUNK_ID: z.string().optional(),

  DEMO_ACADEMY_NAME: z.string().min(1).default('Brooklyn Youth Soccer Academy'),
  DEMO_AGENT_PERSONA_NAME: z.string().min(1).default('Maya'),
  DEMO_RETURNING_PHONE: e164.optional(),

  // Spend guard for the public demo. Unset or 0 means no daily cap (local development).
  DEMO_LIMIT_GLOBAL_PER_DAY: z.coerce.number().int().min(0).optional(),
  // Hard cap on one call. 0 turns the timer off.
  DEMO_MAX_CALL_SECONDS: z.coerce.number().int().min(0).default(180),
  // Pause switch for the public demo (for example when the inference credit is used up): the
  // agent ends every call at entry without a session, and the web token route answers 503.
  DEMO_PAUSED: bool,
});

export type Config = z.infer<typeof baseSchema>;

function trimEmpty(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    const t = v?.trim();
    out[k] = t === '' ? undefined : t;
  }
  return out;
}

/**
 * Loads the repo .env into process.env when the worker was started without `--env-file`
 * (for example by `lk agent dev`, `lk agent console` or `lk agent debugger`). Existing variables
 * win; nothing is logged.
 */
export function loadDotenvIfNeeded(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY) return null;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../.env'), resolve(here, '../.env'), resolve(process.cwd(), '.env')];
  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadDotenvIfNeeded(env);
  const parsed = baseSchema.safeParse(trimEmpty(env));
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${missing}`);
  }
  const cfg = parsed.data;

  // Conditional credentials: only when the feature is on.
  const twilioCore = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;
  if (cfg.FEATURE_SMS) {
    requireAll(cfg, twilioCore, 'FEATURE_SMS');
  }
  if (cfg.FEATURE_OUTBOUND) {
    requireAll(cfg, ['LK_OUTBOUND_TRUNK_ID'], 'FEATURE_OUTBOUND');
  }
  // Provider keys only matter for direct mode; inference mode needs LIVEKIT_* alone.
  if (cfg.MODEL_PROVIDER === 'direct') {
    requireAll(cfg, ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY'], 'MODEL_PROVIDER=direct', '');
  }
  return cfg;
}

function requireAll(cfg: Config, keys: readonly (keyof Config)[], flag: string, suffix = '=true'): void {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(`${flag}${suffix} requires ${missing.join(', ')} in .env`);
  }
}

/** Splits a LiveKit Inference TTS id `provider/model:voice` into model and voice. */
export function splitTtsModel(id: string): { model: string; voice?: string } {
  const idx = id.indexOf(':');
  if (idx === -1) return { model: id };
  return { model: id.slice(0, idx), voice: id.slice(idx + 1) };
}

// ---------- prices for the cost estimate ----------

/**
 * Source: LiveKit Inference pricing page (Build plan rates), checked on 2026-11-09. Direct
 * provider list prices (deepgram.com, openai.com) may differ slightly; the PRICE_* env vars
 * override them. Units: STT per audio minute, TTS per 1M characters, LLM per 1M tokens.
 */
export const PRICES_CHECKED = '2026-11-09 (LiveKit pricing page)';
export const PRICE_TABLE = {
  stt: { 'deepgram/nova-3': 0.0048 } as Record<string, number>,
  tts: { 'deepgram/aura-2': 30 } as Record<string, number>,
  llm: {
    'openai/gpt-6.1-terra': { input: 1.0, cached: 0.05, output: 5.0 },
    'openai/gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  } as Record<string, { input: number; cached: number; output: number }>,
};

export interface Prices {
  sttPerMin: number | null;
  ttsPer1MChars: number | null;
  llm: { input: number; cached: number; output: number } | null;
  checked: string;
}

/** Prices for the configured models: env override first, then the dated table, else null (unpriced). */
export function resolvePrices(cfg: Pick<Config, 'LK_STT_MODEL' | 'LK_LLM_MODEL' | 'LK_TTS_MODEL' | 'PRICE_STT_PER_MIN' | 'PRICE_TTS_PER_1M_CHARS' | 'PRICE_LLM_INPUT_PER_1M' | 'PRICE_LLM_CACHED_PER_1M' | 'PRICE_LLM_OUTPUT_PER_1M'>): Prices {
  const tableLlm = PRICE_TABLE.llm[cfg.LK_LLM_MODEL];
  const input = cfg.PRICE_LLM_INPUT_PER_1M ?? tableLlm?.input;
  const output = cfg.PRICE_LLM_OUTPUT_PER_1M ?? tableLlm?.output;
  const cached = cfg.PRICE_LLM_CACHED_PER_1M ?? tableLlm?.cached ?? input;
  return {
    sttPerMin: cfg.PRICE_STT_PER_MIN ?? PRICE_TABLE.stt[cfg.LK_STT_MODEL] ?? null,
    ttsPer1MChars: cfg.PRICE_TTS_PER_1M_CHARS ?? PRICE_TABLE.tts[splitTtsModel(cfg.LK_TTS_MODEL).model] ?? null,
    llm: input !== undefined && output !== undefined && cached !== undefined ? { input, cached, output } : null,
    checked: PRICES_CHECKED,
  };
}
