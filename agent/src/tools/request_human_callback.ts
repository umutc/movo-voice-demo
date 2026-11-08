import { tool } from '@livekit/agents';
import { z } from 'zod';
import { normalizePhone, type SessionContext } from '../context.ts';
import { SORRY } from './shared.ts';

export const requestHumanCallback = tool({
  name: 'request_human_callback',
  description:
    'Pass a question and a callback number to the academy staff. Use it for pricing policy, refunds, special needs, complaints, anything outside the tool data, or when the caller asks for a person. ' +
    'Call it only after the caller has agreed, in a later turn, to your read-back of the callback number; never in the same turn the caller first says a number, and never with guessed digits. ' +
    'Returns a sentence to say.',
  parameters: z.object({
    reason: z.string().min(1).describe('Short reason for the callback in the caller words'),
    phone: z
      .string()
      .optional()
      .describe(
        'The callback number exactly as the caller confirmed it, digits only, for example 7185550174. Leave it out only when the caller confirmed the number you already have for them, or clearly said they cannot give one.',
      ),
    preferred_time: z.string().optional().describe('When the caller prefers to be called, if they said'),
  }),
  execute: async ({ reason, phone, preferred_time }, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    const startedAt = Date.now();
    // Contact number for the callback row only; identity and the bound family still come from context.
    // A number that was given but cannot be a phone number is refused, so digits are never guessed.
    const callbackPhone = phone ? normalizePhone(phone) : sc.identity.phone;
    if (phone && !callbackPhone) {
      sc.logTool('request_human_callback', false, 'incomplete phone number', startedAt);
      return { sayThis: `${SORRY} that number looks incomplete. Ask the caller for the full number and read it back before logging the callback.` };
    }
    try {
      const cb = await sc.db.createCallbackRequest({ familyId: sc.familyId, phone: callbackPhone, reason, preferredTime: preferred_time ?? null });
      sc.callbackIds.push(cb.id);
      if (sc.outcome !== 'booked') sc.outcome = 'callback';
      sc.logTool('request_human_callback', true, cb.id, startedAt);
      const noted = preferred_time ? ` I noted that ${preferred_time} works best for you.` : '';
      const passed = callbackPhone
        ? "I've passed your question and number to the academy staff."
        : "I've passed your question to the academy staff, but they have no number to reach you.";
      return { sayThis: `${passed}${noted}`, callbackId: cb.id };
    } catch (err) {
      sc.logTool('request_human_callback', false, err instanceof Error ? err.message : String(err), startedAt);
      return { sayThis: `${SORRY} I could not log that callback right now. Please call the academy office directly.` };
    }
  },
});
