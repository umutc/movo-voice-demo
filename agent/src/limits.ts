// Demo spend guards on the agent side: the daily quota for phone calls (browser calls are counted
// by the web token route) and the maximum call length. Spoken lines are fixed text through TTS,
// so neither guard spends LLM tokens.
import { Agent } from '@livekit/agents';
import type { DbPort } from 'db/port';
import { limitOn } from 'db/usage';

export const MAX_DURATION_GOODBYE = 'We have reached the time limit for this demo call. Thank you for calling, goodbye.';
export const PHONE_LINE_CLOSED = 'Sorry, the demo line is closed for today, please call again tomorrow.';

/**
 * Admits one phone call against the global daily cap and records it. With no cap set, nothing is
 * recorded (local development). Fails closed: a failed count refuses the call.
 */
export async function admitPhoneCall(
  db: Pick<DbPort, 'reserveDemoUsage'>,
  globalLimit: number | undefined,
  now: Date,
): Promise<{ admitted: boolean; error?: string }> {
  if (!limitOn(globalLimit)) return { admitted: true };
  try {
    const result = await db.reserveDemoUsage({ channel: 'phone', now, globalLimit });
    return { admitted: result.ok };
  } catch (err) {
    return { admitted: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The part of AgentSession the guards use; AgentSession satisfies it. */
export interface EndableSession {
  say(text: string, options?: { allowInterruptions?: boolean }): { addDoneCallback(callback: () => void): void };
  shutdown(options?: { drain?: boolean; reason?: string }): void;
}

/**
 * Says `text`, then closes the session through the same drain shutdown `end_call` uses, so the
 * Close event, job shutdown and finalize() run as for a normal goodbye. If playout never finishes,
 * a hard shutdown follows after `graceMs`. Returns a cancel function for the fallback.
 */
export function sayAndEnd(session: EndableSession, text: string, reason: string, graceMs = 30_000): () => void {
  const fallback = setTimeout(() => session.shutdown({ drain: false, reason }), graceMs);
  try {
    session.say(text, { allowInterruptions: false }).addDoneCallback(() => {
      clearTimeout(fallback);
      session.shutdown({ drain: true, reason });
    });
  } catch {
    clearTimeout(fallback);
    session.shutdown({ drain: false, reason });
  }
  return () => clearTimeout(fallback);
}

/**
 * Starts the max call length timer. At `maxSeconds` the agent says a short goodbye after any
 * speech already queued (so a booking reply in flight can finish) and ends the call. Returns a
 * function that clears the timer; call it when the session closes.
 */
export function startCallTimer(session: EndableSession, maxSeconds: number, onLimit?: () => void): () => void {
  if (!(maxSeconds > 0)) return () => {};
  let cancelFallback: (() => void) | null = null;
  const timer = setTimeout(() => {
    onLimit?.();
    cancelFallback = sayAndEnd(session, MAX_DURATION_GOODBYE, 'max_duration');
  }, maxSeconds * 1000);
  return () => {
    clearTimeout(timer);
    cancelFallback?.();
  };
}

/** Agent for a phone call refused by the daily cap: one fixed sentence, then the call ends. */
export function buildClosedLineAgent(): Agent {
  return Agent.create({
    instructions: 'The demo line is closed for today. Do not help with anything else.',
    onEnter: async ({ session }) => {
      sayAndEnd(session, PHONE_LINE_CLOSED, 'daily_limit');
    },
  });
}
