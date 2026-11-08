import { z } from 'zod';

// Pause switch for the public demo (DEMO_PAUSED, true/false, default false). The home page
// disables "Start call" and the token route answers 503 while it is on. Same rule as the agent's
// config.ts: an invalid value fails loud instead of silently reopening the demo.

export const PAUSED_NOTICE = 'The voice demo is paused until its monthly model credit resets. The phone line is paused too.';

const pausedSchema = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .optional()
  .transform((v) => v === 'true' || v === '1');

export function demoPaused(env: Record<string, string | undefined> = process.env): boolean {
  const parsed = pausedSchema.safeParse(env.DEMO_PAUSED?.trim());
  if (!parsed.success) throw new Error('DEMO_PAUSED must be true or false');
  return parsed.data;
}
