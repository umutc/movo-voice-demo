import { tool } from '@livekit/agents';
import { z } from 'zod';
import type { SessionContext } from '../context.ts';
import { describeSlot, SORRY } from './shared.ts';

export const proposeBooking = tool({
  name: 'propose_booking',
  description:
    'Prepare a trial booking for the caller to confirm. Call this once the caller has chosen a program and a slot and you know the child name, child age and guardian name. Returns the exact read-back sentence: say it word for word, then wait for the caller to answer. Call it again whenever any detail changes.',
  parameters: z.object({
    program_id: z.string().min(1).describe('Program id from lookup_programs'),
    slot_id: z.string().min(1).describe('Slot id from check_trial_slots'),
    child_name: z.string().min(1).describe('Child first name as the caller said it'),
    child_age: z.number().int().min(1).max(20).describe('Child age in years'),
    guardian_name: z.string().min(1).describe('Name of the parent or guardian on the call'),
  }),
  execute: async ({ program_id, slot_id, child_name, child_age, guardian_name }, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    try {
      const [program, slot] = await Promise.all([sc.db.getProgram(program_id), sc.db.getSlot(slot_id)]);
      if (!program || !slot || slot.programId !== program.id) {
        sc.logTool('propose_booking', false, `bad ids ${program_id}/${slot_id}`);
        return { sayThis: `${SORRY} that slot does not match the program. Let me check the schedule again.`, readbackText: null };
      }
      if (slot.bookedCount >= slot.capacity) {
        sc.logTool('propose_booking', false, `slot ${slot_id} full`);
        return { sayThis: `${SORRY} that slot just filled up. Let me check the schedule for another one.`, readbackText: null };
      }
      const readbackText =
        `Just to confirm: a free trial for ${child_name.trim()}, age ${child_age}, in ${program.name} on ${describeSlot(slot)}, ` +
        `booked under ${guardian_name.trim()}. Shall I book that?`;
      const proposal = sc.proposals.propose({ programId: program.id, slotId: slot.id, childName: child_name, childAge: child_age, guardianName: guardian_name }, readbackText);
      sc.logTool('propose_booking', true, `${proposal.proposalId} ${program.id} ${slot.id} ${child_name.trim()}`);
      return {
        readbackText,
        instruction: 'Say readbackText to the caller word for word and nothing else, then wait for the answer. Do not call book_trial_class until the caller says yes to this exact read-back.',
      };
    } catch (err) {
      sc.logTool('propose_booking', false, err instanceof Error ? err.message : String(err));
      return { sayThis: `${SORRY} I could not prepare that booking right now. Let me try again in a moment.`, readbackText: null };
    }
  },
});
