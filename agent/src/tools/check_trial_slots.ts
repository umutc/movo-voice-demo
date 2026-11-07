import { tool } from '@livekit/agents';
import { z } from 'zod';
import type { SessionContext } from '../context.ts';
import { describeSlot, SORRY } from './shared.ts';

export const checkTrialSlots = tool({
  name: 'check_trial_slots',
  description:
    'List the next open free trial class slots for a program within the next two weeks. Call this after the caller picks a program and before proposing a booking. Returns up to three slots with id, weekday, date, time and coach. Offer two aloud.',
  parameters: z.object({
    program_id: z.string().min(1).describe('Program id from lookup_programs, e.g. u8-prospect'),
  }),
  execute: async ({ program_id }, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    const startedAt = Date.now();
    try {
      const program = await sc.db.getProgram(program_id);
      if (!program) {
        sc.logTool('check_trial_slots', false, `unknown program ${program_id}`, startedAt);
        return { sayThis: `${SORRY} I do not have a program with that id. Let me look up programs again.`, slots: [] };
      }
      const slots = await ctx.filler('One moment, let me check the schedule.', { delay: 400 }, () => sc.db.listOpenSlots(program_id, sc.now(), 3));
      sc.logTool('check_trial_slots', true, `${slots.length} slots for ${program_id}`, startedAt);
      if (slots.length === 0) {
        return { sayThis: `${SORRY} ${program.name} has no open trial slots in the next two weeks. I can have the staff call back with later dates.`, slots: [] };
      }
      return {
        sayThis: `Open trial slots for ${program.name}: ${slots.map(describeSlot).join('; ')}.`,
        slots: slots.map((s) => ({ id: s.id, when: describeSlot(s), startsAtIso: s.startsAt.toISOString(), coach: s.coach, seatsLeft: s.capacity - s.bookedCount })),
      };
    } catch (err) {
      sc.logTool('check_trial_slots', false, err instanceof Error ? err.message : String(err), startedAt);
      return { sayThis: `${SORRY} I could not check the schedule right now. I can have the staff call back.`, slots: [] };
    }
  },
});
