// Idempotent seed: programs upserted, slots inserted if missing (booked counts kept), one demo
// family keyed by DEMO_RETURNING_PHONE (falls back to a synthetic number when unset).
//   pnpm db:seed            -> DATABASE_URL (public)
//   pnpm db:seed -- --test  -> TEST_DATABASE_URL (schema test)
import { eq, sql } from 'drizzle-orm';
import { createDb, type Db } from './client.ts';
import { bookings, callbackRequests, calls, children, demoUsage, families, guardians, programs, trialSlots } from './schema.ts';
import { DEMO_FAMILY, PROGRAMS, generateSlots } from './seed-data.ts';

export const FALLBACK_DEMO_PHONE = '+15555550100';

export async function seedDb(db: Db, opts: { now?: Date; demoPhone?: string } = {}): Promise<{ familyId: string; slots: number }> {
  const now = opts.now ?? new Date();
  const demoPhone = opts.demoPhone ?? FALLBACK_DEMO_PHONE;
  return db.transaction(async (tx) => {
    for (const p of PROGRAMS) {
      await tx
        .insert(programs)
        .values(p)
        .onConflictDoUpdate({
          target: programs.id,
          set: { name: p.name, ageMin: p.ageMin, ageMax: p.ageMax, location: p.location, days: p.days, monthlyPriceCents: p.monthlyPriceCents, description: p.description },
        });
    }
    const slots = generateSlots(now);
    if (slots.length > 0) {
      await tx.insert(trialSlots).values(slots.map((s) => ({ id: s.id, programId: s.programId, startsAt: s.startsAt, coach: s.coach, capacity: s.capacity }))).onConflictDoNothing();
    }

    const existing = await tx.select().from(families).where(eq(families.phone, demoPhone)).limit(1);
    let familyId = existing[0]?.id;
    const lastCallAt = new Date(now.getTime() - 3 * 86_400_000);
    if (!familyId) {
      const [fam] = await tx
        .insert(families)
        .values({ phone: demoPhone, guardianName: DEMO_FAMILY.guardianName, email: DEMO_FAMILY.email, summary: DEMO_FAMILY.summary, lastCallAt, isDemo: true })
        .returning();
      if (!fam) throw new Error('insert families returned no row');
      familyId = fam.id;
      await tx.insert(guardians).values({ familyId, name: DEMO_FAMILY.guardianName, phone: demoPhone, email: DEMO_FAMILY.email, isPrimary: true });
    } else {
      await tx.update(families).set({ isDemo: true, guardianName: DEMO_FAMILY.guardianName, summary: DEMO_FAMILY.summary, lastCallAt }).where(eq(families.id, familyId));
    }
    for (const c of DEMO_FAMILY.children) {
      const kids = await tx.select().from(children).where(sql`${children.familyId} = ${familyId} and lower(${children.name}) = ${c.name.toLowerCase()}`).limit(1);
      if (!kids[0]) await tx.insert(children).values({ familyId, name: c.name, age: c.age });
    }
    const prior = await tx.select().from(calls).where(sql`${calls.familyId} = ${familyId} and ${calls.roomName} = 'seed-prior-inquiry'`).limit(1);
    if (!prior[0]) {
      await tx.insert(calls).values({
        direction: 'inbound',
        identitySource: 'caller_id_only',
        phone: demoPhone,
        familyId,
        roomName: 'seed-prior-inquiry',
        startedAt: lastCallAt,
        endedAt: new Date(lastCallAt.getTime() + 4 * 60_000),
        outcome: 'inquiry',
        summary: DEMO_FAMILY.summary,
      });
    }
    return { familyId, slots: slots.length };
  });
}

/** Test helper: empties every table in the connected schema. */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`truncate table ${bookings}, ${callbackRequests}, ${calls}, ${demoUsage}, ${children}, ${guardians}, ${families}, ${trialSlots}, ${programs} restart identity cascade`);
}

async function main(): Promise<void> {
  const isTest = process.argv.includes('--test');
  const url = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(isTest ? 'TEST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  const { db, close } = createDb(url, { max: 1 });
  try {
    const demoPhone = process.env.DEMO_RETURNING_PHONE?.trim() || FALLBACK_DEMO_PHONE;
    const r = await seedDb(db, { demoPhone });
    console.log(`seeded ${isTest ? 'test' : 'public'} schema: ${PROGRAMS.length} programs, ${r.slots} slots in the next 14 days, demo family ${r.familyId} (${demoPhone === FALLBACK_DEMO_PHONE ? 'fallback phone' : 'DEMO_RETURNING_PHONE'})`);
  } finally {
    await close();
  }
}

if (process.env.VITEST === undefined) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
