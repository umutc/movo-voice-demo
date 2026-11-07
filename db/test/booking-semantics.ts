// Shared booking-semantics cases, run against the fake (pnpm test) and the real adapter
// (pnpm test:db). Each case gets a fresh, seeded port.
import { expect } from 'vitest';
import type { DbPort } from '../port.ts';

export interface Harness {
  port: DbPort;
  now: Date;
}

export async function lastSeatIsBookedOnce(h: Harness): Promise<void> {
  const fam = await h.port.createFamily({ phone: '+15555550201', guardianName: 'Test Parent' });
  const a = await h.port.findOrCreateChild(fam.id, 'Ava', 7);
  const b = await h.port.findOrCreateChild(fam.id, 'Ben', 7);
  const [slot] = await h.port.listOpenSlots('u8-prospect', h.now, 1);
  expect(slot).toBeDefined();
  // Fill all seats but one with other children.
  for (let i = 0; i < slot!.capacity - 1; i++) {
    const kid = await h.port.findOrCreateChild(fam.id, `Filler ${i}`, 7);
    const r = await h.port.bookTrialClass({ familyId: fam.id, childId: kid.id, programId: 'u8-prospect', slotId: slot!.id });
    expect(r.ok).toBe(true);
  }
  const [ra, rb] = await Promise.all([
    h.port.bookTrialClass({ familyId: fam.id, childId: a.id, programId: 'u8-prospect', slotId: slot!.id }),
    h.port.bookTrialClass({ familyId: fam.id, childId: b.id, programId: 'u8-prospect', slotId: slot!.id }),
  ]);
  const oks = [ra, rb].filter((r) => r.ok);
  const fulls = [ra, rb].filter((r) => !r.ok && r.reason === 'slot_full');
  expect(oks).toHaveLength(1);
  expect(fulls).toHaveLength(1);
  const after = await h.port.getSlot(slot!.id);
  expect(after!.bookedCount).toBe(after!.capacity);
}

export async function repeatOnFullSlotReturnsOriginal(h: Harness): Promise<void> {
  const fam = await h.port.createFamily({ phone: '+15555550202', guardianName: 'Test Parent' });
  const kid = await h.port.findOrCreateChild(fam.id, 'Cara', 9);
  const [slot] = await h.port.listOpenSlots('u10-mccarren', h.now, 1);
  const first = await h.port.bookTrialClass({ familyId: fam.id, childId: kid.id, programId: 'u10-mccarren', slotId: slot!.id });
  expect(first.ok && first.created).toBe(true);
  for (let i = 0; i < slot!.capacity - 1; i++) {
    const other = await h.port.findOrCreateChild(fam.id, `Other ${i}`, 9);
    const r = await h.port.bookTrialClass({ familyId: fam.id, childId: other.id, programId: 'u10-mccarren', slotId: slot!.id });
    expect(r.ok).toBe(true);
  }
  const full = await h.port.getSlot(slot!.id);
  expect(full!.bookedCount).toBe(full!.capacity);
  const again = await h.port.bookTrialClass({ familyId: fam.id, childId: kid.id, programId: 'u10-mccarren', slotId: slot!.id });
  expect(again.ok).toBe(true);
  if (again.ok && first.ok) {
    expect(again.created).toBe(false);
    expect(again.booking.id).toBe(first.booking.id);
  }
  const still = await h.port.getSlot(slot!.id);
  expect(still!.bookedCount).toBe(full!.capacity);
}

export async function differentChildOnFullSlotRefused(h: Harness): Promise<void> {
  const fam = await h.port.createFamily({ phone: '+15555550203', guardianName: 'Test Parent' });
  const [slot] = await h.port.listOpenSlots('u6-prospect', h.now, 1);
  for (let i = 0; i < slot!.capacity; i++) {
    const kid = await h.port.findOrCreateChild(fam.id, `Kid ${i}`, 5);
    const r = await h.port.bookTrialClass({ familyId: fam.id, childId: kid.id, programId: 'u6-prospect', slotId: slot!.id });
    expect(r.ok).toBe(true);
  }
  const late = await h.port.findOrCreateChild(fam.id, 'Late Kid', 5);
  const r = await h.port.bookTrialClass({ familyId: fam.id, childId: late.id, programId: 'u6-prospect', slotId: slot!.id });
  expect(r).toEqual({ ok: false, reason: 'slot_full' });
  const open = await h.port.listOpenSlots('u6-prospect', h.now, 10);
  expect(open.find((s) => s.id === slot!.id)).toBeUndefined();
}

export async function findOrCreateChildIsStable(h: Harness): Promise<void> {
  const fam = await h.port.createFamily({ phone: '+15555550204', guardianName: 'Test Parent' });
  const a = await h.port.findOrCreateChild(fam.id, 'Emma', 7);
  const b = await h.port.findOrCreateChild(fam.id, '  emma ', 7);
  const c = await h.port.findOrCreateChild(fam.id, 'EMMA', 8);
  expect(b.id).toBe(a.id);
  expect(c.id).toBe(a.id);
  expect(c.age).toBe(8);
  const other = await h.port.findOrCreateChild(fam.id, 'Emma Rose', 7);
  expect(other.id).not.toBe(a.id);
  const otherFam = await h.port.createFamily({ phone: '+15555550205' });
  const far = await h.port.findOrCreateChild(otherFam.id, 'Emma', 7);
  expect(far.id).not.toBe(a.id);
}

export async function siblingsShareASlot(h: Harness): Promise<void> {
  const fam = await h.port.createFamily({ phone: '+15555550206', guardianName: 'Test Parent' });
  const a = await h.port.findOrCreateChild(fam.id, 'Sam', 11);
  const b = await h.port.findOrCreateChild(fam.id, 'Max', 10);
  const [slot] = await h.port.listOpenSlots('u12-mccarren', h.now, 1);
  const ra = await h.port.bookTrialClass({ familyId: fam.id, childId: a.id, programId: 'u12-mccarren', slotId: slot!.id });
  const rb = await h.port.bookTrialClass({ familyId: fam.id, childId: b.id, programId: 'u12-mccarren', slotId: slot!.id });
  expect(ra.ok && rb.ok).toBe(true);
  const after = await h.port.getSlot(slot!.id);
  expect(after!.bookedCount).toBe(2);
}

export async function demoFamilyIsSeeded(h: Harness, demoPhone: string): Promise<void> {
  const fam = await h.port.findFamilyByPhone(demoPhone);
  expect(fam).not.toBeNull();
  expect(fam!.isDemo).toBe(true);
  expect(fam!.children.map((c) => c.name)).toContain('Emma');
  expect(fam!.summary).toContain('Emma');
  const programsFor7 = await h.port.listPrograms(7);
  expect(programsFor7.map((p) => p.id)).toEqual(['u8-prospect']);
  const programsFor3 = await h.port.listPrograms(3);
  expect(programsFor3).toEqual([]);
}
