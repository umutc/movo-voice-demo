// Read-only helpers for the web app. Opens a short-lived connection per call; the Next.js dev
// server keeps no pool across hot reloads.
import { desc, eq } from 'drizzle-orm';
import { createDb } from './client.ts';
import { bookings, calls, children, families, programs, trialSlots } from './schema.ts';

export interface CallView {
  call: { id: string; direction: string; identitySource: string; startedAt: string; endedAt: string | null; outcome: string | null; summary: string | null; familyId: string | null };
  family: { guardianName: string | null; isDemo: boolean; summary: string | null } | null;
  booking: {
    id: string;
    childName: string;
    childAge: number;
    programName: string;
    location: string;
    startsAt: string;
    coach: string;
    guardianName: string | null;
  } | null;
}

export async function getCallView(url: string, callId: string): Promise<CallView | null> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    if (!call) return null;
    let family: CallView['family'] = null;
    let booking: CallView['booking'] = null;
    if (call.familyId) {
      const [fam] = await db.select().from(families).where(eq(families.id, call.familyId)).limit(1);
      if (fam) family = { guardianName: fam.guardianName, isDemo: fam.isDemo, summary: fam.summary };
      const rows = await db
        .select({ booking: bookings, child: children, program: programs, slot: trialSlots })
        .from(bookings)
        .innerJoin(children, eq(bookings.childId, children.id))
        .innerJoin(programs, eq(bookings.programId, programs.id))
        .innerJoin(trialSlots, eq(bookings.slotId, trialSlots.id))
        .where(eq(bookings.familyId, call.familyId))
        .orderBy(desc(bookings.createdAt))
        .limit(1);
      const row = rows[0];
      // Only a booking made during this call counts (created after the call started).
      if (row && row.booking.createdAt.getTime() >= call.startedAt.getTime() - 5_000) {
        booking = {
          id: row.booking.id,
          childName: row.child.name,
          childAge: row.child.age,
          programName: row.program.name,
          location: row.program.location,
          startsAt: row.slot.startsAt.toISOString(),
          coach: row.slot.coach,
          guardianName: fam?.guardianName ?? null,
        };
      }
    }
    return {
      call: {
        id: call.id,
        direction: call.direction,
        identitySource: call.identitySource,
        startedAt: call.startedAt.toISOString(),
        endedAt: call.endedAt?.toISOString() ?? null,
        outcome: call.outcome,
        summary: call.summary,
        familyId: call.familyId,
      },
      family,
      booking,
    };
  } finally {
    await close();
  }
}
