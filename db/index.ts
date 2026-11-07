// Real DbPort adapter: Drizzle ORM over postgres.js. Booking semantics per PRD section 8 are
// enforced inside one transaction with a row lock on the slot.
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { createDb, type Db } from './client.ts';
import type {
  Booking,
  BookTrialResult,
  CallbackRequest,
  CallRecord,
  Child,
  DbPort,
  Family,
  FamilyWithDetails,
  Guardian,
  Program,
  TrialSlot,
} from './port.ts';
import { bookings, callbackRequests, calls, children, families, guardians, programs, trialSlots } from './schema.ts';

export type { DbPort } from './port.ts';
export { createDb } from './client.ts';
export { normalizeName } from './fake.ts';

function rowToFamily(r: typeof families.$inferSelect): Family {
  return {
    id: r.id,
    phone: r.phone,
    guardianName: r.guardianName,
    email: r.email,
    summary: r.summary,
    lastCallAt: r.lastCallAt,
    isDemo: r.isDemo,
    createdAt: r.createdAt,
  };
}

function rowToCall(r: typeof calls.$inferSelect): CallRecord {
  return {
    id: r.id,
    direction: r.direction as CallRecord['direction'],
    identitySource: r.identitySource as CallRecord['identitySource'],
    phone: r.phone,
    familyId: r.familyId,
    roomName: r.roomName,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    outcome: r.outcome,
    summary: r.summary,
    transcript: r.transcript,
    metrics: r.metrics,
    traceId: r.traceId,
  };
}

function rowToBooking(r: typeof bookings.$inferSelect): Booking {
  return { ...r, status: r.status as Booking['status'] };
}

export class DrizzleDb implements DbPort {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  private async withDetails(fam: Family): Promise<FamilyWithDetails> {
    const kids = await this.db.select().from(children).where(eq(children.familyId, fam.id)).orderBy(asc(children.name));
    const last = await this.db
      .select({ booking: bookings, slot: trialSlots, program: programs, child: children })
      .from(bookings)
      .innerJoin(trialSlots, eq(bookings.slotId, trialSlots.id))
      .innerJoin(programs, eq(bookings.programId, programs.id))
      .innerJoin(children, eq(bookings.childId, children.id))
      .where(eq(bookings.familyId, fam.id))
      .orderBy(desc(bookings.createdAt))
      .limit(1);
    const row = last[0];
    return {
      ...fam,
      children: kids,
      lastBooking: row ? { ...rowToBooking(row.booking), slot: row.slot, program: row.program, child: row.child } : null,
    };
  }

  async findFamilyByPhone(phone: string): Promise<FamilyWithDetails | null> {
    const rows = await this.db.select().from(families).where(eq(families.phone, phone)).limit(1);
    const fam = rows[0];
    return fam ? this.withDetails(rowToFamily(fam)) : null;
  }

  async findFamilyById(id: string): Promise<FamilyWithDetails | null> {
    const rows = await this.db.select().from(families).where(eq(families.id, id)).limit(1);
    const fam = rows[0];
    return fam ? this.withDetails(rowToFamily(fam)) : null;
  }

  async createFamily(input: { phone?: string | null; guardianName?: string | null; email?: string | null; isDemo?: boolean }): Promise<Family> {
    return this.db.transaction(async (tx) => {
      const [fam] = await tx
        .insert(families)
        .values({ phone: input.phone ?? null, guardianName: input.guardianName ?? null, email: input.email ?? null, isDemo: input.isDemo ?? false })
        .returning();
      if (!fam) throw new Error('insert families returned no row');
      if (input.guardianName) {
        await tx.insert(guardians).values({ familyId: fam.id, name: input.guardianName, phone: fam.phone, email: fam.email, isPrimary: true });
      }
      return rowToFamily(fam);
    });
  }

  async updateFamilyContact(familyId: string, input: { guardianName?: string; email?: string }): Promise<void> {
    const patch: Partial<typeof families.$inferInsert> = {};
    if (input.guardianName !== undefined) patch.guardianName = input.guardianName;
    if (input.email !== undefined) patch.email = input.email;
    if (Object.keys(patch).length === 0) return;
    await this.db.update(families).set(patch).where(eq(families.id, familyId));
  }

  async upsertFamilySummary(familyId: string, summary: string, lastCallAt: Date): Promise<void> {
    await this.db.update(families).set({ summary, lastCallAt }).where(eq(families.id, familyId));
  }

  async findOrCreateChild(familyId: string, name: string, age: number): Promise<Child> {
    const norm = name.trim().toLowerCase().replace(/\s+/g, ' ');
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(children)
        .where(and(eq(children.familyId, familyId), eq(sql`lower(regexp_replace(trim(${children.name}), '\\s+', ' ', 'g'))`, norm)))
        .limit(1);
      const found = existing[0];
      if (found) {
        if (found.age !== age) {
          await tx.update(children).set({ age }).where(eq(children.id, found.id));
          return { ...found, age };
        }
        return found;
      }
      const [created] = await tx.insert(children).values({ familyId, name: name.trim(), age }).returning();
      if (!created) throw new Error('insert children returned no row');
      return created;
    });
  }

  async listPrograms(age: number, locationPref?: string): Promise<Program[]> {
    const rows = await this.db
      .select()
      .from(programs)
      .where(and(lte(programs.ageMin, age), gt(sql`${programs.ageMax} + 1`, age)))
      .orderBy(asc(programs.ageMin));
    if (locationPref) {
      const pref = locationPref.toLowerCase();
      const preferred = rows.filter((p) => p.location.toLowerCase().includes(pref));
      const rest = rows.filter((p) => !preferred.includes(p));
      return [...preferred, ...rest].slice(0, 3);
    }
    return rows.slice(0, 3);
  }

  async getProgram(programId: string): Promise<Program | null> {
    const rows = await this.db.select().from(programs).where(eq(programs.id, programId)).limit(1);
    return rows[0] ?? null;
  }

  async listOpenSlots(programId: string, now: Date, limit = 3): Promise<TrialSlot[]> {
    const horizon = new Date(now.getTime() + 14 * 86_400_000);
    return this.db
      .select()
      .from(trialSlots)
      .where(
        and(
          eq(trialSlots.programId, programId),
          gt(trialSlots.startsAt, now),
          lte(trialSlots.startsAt, horizon),
          sql`${trialSlots.bookedCount} < ${trialSlots.capacity}`,
        ),
      )
      .orderBy(asc(trialSlots.startsAt))
      .limit(limit);
  }

  async getSlot(slotId: string): Promise<TrialSlot | null> {
    const rows = await this.db.select().from(trialSlots).where(eq(trialSlots.id, slotId)).limit(1);
    return rows[0] ?? null;
  }

  async bookTrialClass(input: { familyId: string; childId: string; programId: string; slotId: string }): Promise<BookTrialResult> {
    return this.db.transaction(async (tx) => {
      // 1. Lock the slot row for the rest of the transaction.
      const locked = await tx.select().from(trialSlots).where(eq(trialSlots.id, input.slotId)).for('update');
      const slot = locked[0];
      if (!slot) return { ok: false, reason: 'slot_not_found' } as const;
      if (slot.programId !== input.programId) return { ok: false, reason: 'program_mismatch' } as const;
      const [program] = await tx.select().from(programs).where(eq(programs.id, slot.programId)).limit(1);
      if (!program) return { ok: false, reason: 'program_mismatch' } as const;
      const [child] = await tx.select().from(children).where(and(eq(children.id, input.childId), eq(children.familyId, input.familyId))).limit(1);
      if (!child) return { ok: false, reason: 'child_not_found' } as const;

      // 2. Existing booking for (child, slot) is returned unchanged, even if the slot is full now.
      const [existing] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.childId, input.childId), eq(bookings.slotId, input.slotId)))
        .limit(1);
      if (existing) return { ok: true, booking: rowToBooking(existing), created: false, slot, program, child } as const;

      // 3. Capacity check only for a new booking.
      if (slot.bookedCount >= slot.capacity) return { ok: false, reason: 'slot_full' } as const;

      // 4. Insert with ON CONFLICT DO NOTHING; 5. increment only when a row was inserted.
      const inserted = await tx
        .insert(bookings)
        .values({ familyId: input.familyId, childId: input.childId, programId: input.programId, slotId: input.slotId, status: 'confirmed' })
        .onConflictDoNothing({ target: [bookings.childId, bookings.slotId] })
        .returning();
      const booking = inserted[0];
      if (!booking) {
        const [race] = await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.childId, input.childId), eq(bookings.slotId, input.slotId)))
          .limit(1);
        if (!race) throw new Error('booking insert conflicted but no row found');
        return { ok: true, booking: rowToBooking(race), created: false, slot, program, child } as const;
      }
      const [updatedSlot] = await tx
        .update(trialSlots)
        .set({ bookedCount: sql`${trialSlots.bookedCount} + 1` })
        .where(eq(trialSlots.id, input.slotId))
        .returning();
      return { ok: true, booking: rowToBooking(booking), created: true, slot: updatedSlot ?? slot, program, child } as const;
    });
  }

  async getBooking(bookingId: string): Promise<(Booking & { slot: TrialSlot; program: Program; child: Child }) | null> {
    const rows = await this.db
      .select({ booking: bookings, slot: trialSlots, program: programs, child: children })
      .from(bookings)
      .innerJoin(trialSlots, eq(bookings.slotId, trialSlots.id))
      .innerJoin(programs, eq(bookings.programId, programs.id))
      .innerJoin(children, eq(bookings.childId, children.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    const row = rows[0];
    return row ? { ...rowToBooking(row.booking), slot: row.slot, program: row.program, child: row.child } : null;
  }

  async createCallbackRequest(input: { familyId?: string | null; phone?: string | null; reason: string; preferredTime?: string | null }): Promise<CallbackRequest> {
    const [row] = await this.db
      .insert(callbackRequests)
      .values({ familyId: input.familyId ?? null, phone: input.phone ?? null, reason: input.reason, preferredTime: input.preferredTime ?? null })
      .returning();
    if (!row) throw new Error('insert callback_requests returned no row');
    return row;
  }

  async addGuardian(input: { familyId: string; name: string; phone?: string | null; email?: string | null }): Promise<Guardian> {
    const [row] = await this.db
      .insert(guardians)
      .values({ familyId: input.familyId, name: input.name, phone: input.phone ?? null, email: input.email ?? null, isPrimary: false })
      .returning();
    if (!row) throw new Error('insert guardians returned no row');
    return row;
  }

  async insertCall(input: { direction: CallRecord['direction']; identitySource: CallRecord['identitySource']; phone?: string | null; familyId?: string | null; roomName: string; startedAt: Date }): Promise<CallRecord> {
    const [row] = await this.db
      .insert(calls)
      .values({
        direction: input.direction,
        identitySource: input.identitySource,
        phone: input.phone ?? null,
        familyId: input.familyId ?? null,
        roomName: input.roomName,
        startedAt: input.startedAt,
      })
      .returning();
    if (!row) throw new Error('insert calls returned no row');
    return rowToCall(row);
  }

  async finishCall(callId: string, input: { endedAt: Date; outcome: string; summary?: string | null; familyId?: string | null; transcript?: unknown; metrics?: unknown; traceId?: string | null }): Promise<void> {
    const patch: Partial<typeof calls.$inferInsert> = { endedAt: input.endedAt, outcome: input.outcome };
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.familyId !== undefined) patch.familyId = input.familyId;
    if (input.transcript !== undefined) patch.transcript = input.transcript;
    if (input.metrics !== undefined) patch.metrics = input.metrics;
    if (input.traceId !== undefined) patch.traceId = input.traceId;
    await this.db.update(calls).set(patch).where(eq(calls.id, callId));
  }

  async getCall(callId: string): Promise<CallRecord | null> {
    const rows = await this.db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    const row = rows[0];
    return row ? rowToCall(row) : null;
  }
}

/** Opens the app database (transaction pooler, prepare: false) and returns the adapter. */
export function openDb(url = process.env.DATABASE_URL): { port: DrizzleDb; db: Db; close: () => Promise<void> } {
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, close } = createDb(url);
  return { port: new DrizzleDb(db), db, close };
}
