import { tool } from '@livekit/agents';
import { z } from 'zod';
import type { SessionContext } from '../context.ts';

export const endCall = tool({
  name: 'end_call',
  description: 'End the call after you have said goodbye and the caller has nothing else. The call closes once your last sentence finishes playing.',
  parameters: z.object({}),
  execute: async (_args, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    sc.endRequested = true;
    sc.logTool('end_call', true, 'requested');
    // Close after the speech that contains this tool call (and its goodbye) has played out.
    ctx.speechHandle.addDoneCallback(() => {
      ctx.session.shutdown({ drain: true, reason: 'end_call' });
    });
    return { sayThis: 'Say a one sentence goodbye now; the call will close after it.' };
  },
});
