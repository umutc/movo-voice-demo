import { tool } from '@livekit/agents';
import { z } from 'zod';
import type { SessionContext } from '../context.ts';
import { describeSlot, SORRY } from './shared.ts';

export const bookTrialClass = tool({
  name: 'book_trial_class',
  description:
    'Book the trial class the caller just confirmed. Call this only right after the caller said yes to the read-back from propose_booking, with the same program, slot and child. It refuses when there is no fresh confirmed read-back. Say the returned confirmation sentence.',
  parameters: z.object({
    program_id: z.string().min(1).describe('Program id, same as in propose_booking'),
    slot_id: z.string().min(1).describe('Slot id, same as in propose_booking'),
    child_name: z.string().min(1).describe('Child first name, same as in propose_booking'),
  }),
  execute: async ({ program_id, slot_id, child_name }, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    const refusal = sc.proposals.authorize({ programId: program_id, slotId: slot_id, childName: child_name });
    if (refusal) {
      sc.logTool('book_trial_class', false, `refused: ${refusal}`);
      return { sayThis: `${SORRY} ${refusal.charAt(0).toLowerCase()}${refusal.slice(1)}`, booked: false };
    }
    const proposal = sc.proposals.current!;
    try {
      const familyId = await sc.ensureFamily({ guardianName: proposal.guardianName });
      const child = await sc.db.findOrCreateChild(familyId, proposal.childName, proposal.childAge);
      const result = await ctx.filler('One moment, let me book that.', { delay: 400 }, () =>
        sc.db.bookTrialClass({ familyId, childId: child.id, programId: proposal.programId, slotId: proposal.slotId }),
      );
      if (!result.ok) {
        sc.proposals.consume();
        const why =
          result.reason === 'slot_full'
            ? 'that slot just filled up. Let me check the schedule for another one.'
            : 'I could not complete that booking. Let me check the schedule again.';
        sc.logTool('book_trial_class', false, result.reason);
        return { sayThis: `${SORRY} ${why}`, booked: false };
      }
      sc.proposals.consume();
      sc.bookingIds.push(result.booking.id);
      sc.outcome = 'booked';
      if (sc.identity.guardianName === null && proposal.guardianName && sc.family && !sc.family.guardianName) {
        await sc.db.updateFamilyContact(familyId, { guardianName: proposal.guardianName });
      }
      sc.logTool('book_trial_class', true, `${result.booking.id}${result.created ? '' : ' (existing)'}`);
      return {
        sayThis: `${result.child.name}'s free trial is set for ${describeSlot(result.slot)} in ${result.program.name}. Please arrive ten minutes early with water and sneakers.`,
        booked: true,
        alreadyExisted: !result.created,
      };
    } catch (err) {
      sc.logTool('book_trial_class', false, err instanceof Error ? err.message : String(err));
      return { sayThis: `${SORRY} I could not complete the booking right now. I can have the staff call back to finish it.`, booked: false };
    }
  },
});
