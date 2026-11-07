import { bookTrialClass } from './book_trial_class.ts';
import { checkTrialSlots } from './check_trial_slots.ts';
import { endCall } from './end_call.ts';
import { lookupPrograms } from './lookup_programs.ts';
import { proposeBooking } from './propose_booking.ts';
import { requestHumanCallback } from './request_human_callback.ts';

export const coreTools = [lookupPrograms, checkTrialSlots, proposeBooking, bookTrialClass, requestHumanCallback, endCall];
export { bookTrialClass, checkTrialSlots, endCall, lookupPrograms, proposeBooking, requestHumanCallback };
