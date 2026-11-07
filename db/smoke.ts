// Smoke check against DATABASE_URL: programs for age 7 and their open slots.
import { openDb } from './index.ts';

const { port, close } = openDb();
try {
  const progs = await port.listPrograms(7);
  console.log(`programs for age 7: ${progs.map((p) => `${p.name} (${p.id}, $${p.monthlyPriceCents / 100}/mo)`).join(', ') || 'none'}`);
  for (const p of progs) {
    const slots = await port.listOpenSlots(p.id, new Date());
    console.log(`  ${p.id}: ${slots.length} open slots, first ${slots[0]?.startsAt.toISOString() ?? 'n/a'} with ${slots[0]?.coach ?? 'n/a'}`);
  }
} finally {
  await close();
}
