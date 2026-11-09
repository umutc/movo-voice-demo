import { z } from 'zod';

// Pause switch for the public demo. The demo is paused when DEMO_PAUSED is true (env, the main
// switch) OR the demo_state row says paused (set by `pnpm demo:pause` or by the agent's automatic
// pause on a provider credit error). The home page disables "Start call" and the token route
// answers 503 while it is on. Same rule as the agent's config.ts: an invalid DEMO_PAUSED fails
// loud instead of silently reopening the demo.

export const PAUSED_NOTICE = 'The voice demo is paused until its monthly model credit resets. The phone line is paused too.';
const CREDIT_NOTICE = 'The voice demo is paused because its model credit ran out. The phone line is paused too.';
const GENERIC_NOTICE = 'The voice demo is paused right now. The phone line is paused too.';

const pausedSchema = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .optional()
  .transform((v) => v === 'true' || v === '1');

export function demoPaused(env: Record<string, string | undefined> = process.env): boolean {
  const parsed = pausedSchema.safeParse(env.DEMO_PAUSED?.trim());
  if (!parsed.success) throw new Error('DEMO_PAUSED must be true or false');
  return parsed.data;
}

/**
 * The notice for a paused demo. The database reason is free text, so it is never shown as is:
 * it only picks one of the fixed sentences. The env switch keeps the original notice.
 */
export function pausedNotice(source: { env: boolean; reason?: string | null }): string {
  if (source.env) return PAUSED_NOTICE;
  if (source.reason?.startsWith('provider_credit')) return CREDIT_NOTICE;
  return GENERIC_NOTICE;
}
