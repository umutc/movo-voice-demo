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
  return cfg;
}

function requireAll(cfg: Config, keys: readonly (keyof Config)[], flag: string): void {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(`${flag}=true requires ${missing.join(', ')} in .env`);
  }
}

/** Splits a LiveKit Inference TTS id `provider/model:voice` into model and voice. */
export function splitTtsModel(id: string): { model: string; voice?: string } {
  const idx = id.indexOf(':');
  if (idx === -1) return { model: id };
  return { model: id.slice(0, idx), voice: id.slice(idx + 1) };
}
