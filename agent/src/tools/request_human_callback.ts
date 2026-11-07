import { tool } from '@livekit/agents';
import { z } from 'zod';
import type { SessionContext } from '../context.ts';
import { SORRY } from './shared.ts';

export const requestHumanCallback = tool({
  name: 'request_human_callback',
  description:
    'Ask the academy staff to call the caller back. Use it for pricing policy, refunds, special needs, complaints, anything outside the tool data, or when the caller asks for a person. Returns a confirmation sentence.',
  parameters: z.object({
    reason: z.string().min(1).describe('Short reason for the callback in the caller words'),
    preferred_time: z.string().optional().describe('When the caller prefers to be called, if they said'),
  }),
  execute: async ({ reason, preferred_time }, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    try {
      const cb = await sc.db.createCallbackRequest({ familyId: sc.familyId, phone: sc.identity.phone, reason, preferredTime: preferred_time ?? null });
      sc.callbackIds.push(cb.id);
      if (sc.outcome !== 'booked') sc.outcome = 'callback';
      sc.logTool('request_human_callback', true, cb.id);
      const when = preferred_time ? ` ${preferred_time}` : ' within one business day';
      const to = sc.identity.phone ? ' at the number you are calling from' : '';
      return { sayThis: `The academy staff will call you back${to}${when} about that.`, callbackId: cb.id };
    } catch (err) {
      sc.logTool('request_human_callback', false, err instanceof Error ? err.message : String(err));
      return { sayThis: `${SORRY} I could not log that callback right now. Please call the academy office directly.` };
    }
  },
});
