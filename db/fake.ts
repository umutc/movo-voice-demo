// In-memory DbPort with the same semantics as the real adapter (PRD section 8). Used by behavior
// tests and evals. Seeded from db/seed-data.ts; `reset()` restores the seed.
import type {
  Booking,
  BookTrialResult,
  CallbackRequest,
  CallRecord,
  Child,
  DbPort,
  DemoChannel,
  DemoUsageRequest,
  DemoUsageResult,
  Family,
  FamilyWithDetails,
  Guardian,
  Program,
  TrialSlot,
} from './port.ts';
import { DEMO_FAMILY, PROGRAMS, generateSlots } from './seed-data.ts';
import { decideDemoUsage, utcDayStart } from './usage.ts';

export interface DemoUsageRow {
  id: string;
  channel: DemoChannel;
  ipHash: string | null;
  createdAt: Date;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface FakeDbOptions {
  now?: Date;
  demoPhone?: string | null;
}

export class FakeDb implements DbPort {
  families = new Map<string, Family>();
  children = new Map<string, Child>();
  guardians = new Map<string, Guardian>();
  programs = new Map<string, Program>();
  slots = new Map<string, TrialSlot>();
  bookings = new Map<string, Booking>();
  calls = new Map<string, CallRecord>();
  callbacks = new Map<string, CallbackRequest>();
  demoUsage: DemoUsageRow[] = [];
  private seq = 0;
  private readonly opts: FakeDbOptions;

  constructor(opts: FakeDbOptions = {}) {
    this.opts = opts;
    this.reset();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }

  reset(): void {
    this.families.clear();
    this.children.clear();
    this.guardians.clear();
    this.programs.clear();
    this.slots.clear();
    this.bookings.clear();
    this.calls.clear();
    this.callbacks.clear();
    this.demoUsage = [];
    this.seq = 0;
    const now = this.opts.now ?? new Date();
    for (const p of PROGRAMS) this.programs.set(p.id, { ...p });
    for (const s of generateSlots(now)) this.slots.set(s.id, { ...s });
    if (this.opts.demoPhone !== null) {
      const phone = this.opts.demoPhone ?? '+15555550100';
      const fam: Family = {
        id: this.nextId('fam'),
        phone,
        guardianName: DEMO_FAMILY.guardianName,
        email: DEMO_FAMILY.email,
        summary: DEMO_FAMILY.summary,
        lastCallAt: new Date(now.getTime() - 3 * 86_400_000),
        isDemo: true,
        createdAt: new Date(now.getTime() - 3 * 86_400_000),
      };
      this.families.set(fam.id, fam);
      for (const c of DEMO_FAMILY.children) {
        const id = this.nextId('child');
        this.children.set(id, { id, familyId: fam.id, name: c.name, age: c.age });
      }
      const gid = this.nextId('guardian');
      this.guardians.set(gid, { id: gid, familyId: fam.id, name: DEMO_FAMILY.guardianName, phone, email: DEMO_FAMILY.email, isPrimary: true });
      const cid = this.nextId('call');
      this.calls.set(cid, {
        id: cid,
        direction: 'inbound',
        identitySource: 'caller_id_only',
        phone,
        familyId: fam.id,
        roomName: 'seed-prior-inquiry',
        startedAt: fam.lastCallAt!,
        endedAt: new Date(fam.lastCallAt!.getTime() + 4 * 60_000),
        outcome: 'inquiry',
        summary: DEMO_FAMILY.summary,
        transcript: null,
        metrics: null,
        traceId: null,
      });
    }
  }

  private withDetails(fam: Family): FamilyWithDetails {
    const kids = [...this.children.values()].filter((c) => c.familyId === fam.id);
    const famBookings = [...this.bookings.values()]
      .filter((b) => b.familyId === fam.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const last = famBookings[0];
    let lastBooking: FamilyWithDetails['lastBooking'] = null;
    if (last) {
      const slot = this.slots.get(last.slotId);
      const program = this.programs.get(last.programId);
      const child = this.children.get(last.childId);
      if (slot && program && child) lastBooking = { ...last, slot: { ...slot }, program: { ...program }, child: { ...child } };
    }
    return { ...fam, children: kids.map((c) => ({ ...c })), lastBooking };
  }

  async findFamilyByPhone(phone: string): Promise<FamilyWithDetails | null> {
    const fam = [...this.families.values()].find((f) => f.phone === phone);
    return fam ? this.withDetails(fam) : null;
  }

  async findFamilyById(id: string): Promise<FamilyWithDetails | null> {
    const fam = this.families.get(id);
    return fam ? this.withDetails(fam) : null;
  }

  async createFamily(input: { phone?: string | null; guardianName?: string | null; email?: string | null; isDemo?: boolean }): Promise<Family> {
    if (input.phone && [...this.families.values()].some((f) => f.phone === input.phone)) {
      throw new Error('family phone already exists');
    }
    const fam: Family = {
      id: this.nextId('fam'),
      phone: input.phone ?? null,
      guardianName: input.guardianName ?? null,
      email: input.email ?? null,
      summary: null,
      lastCallAt: null,
      isDemo: input.isDemo ?? false,
      createdAt: new Date(),
    };
    this.families.set(fam.id, fam);
    if (input.guardianName) {
      const gid = this.nextId('guardian');
      this.guardians.set(gid, { id: gid, familyId: fam.id, name: input.guardianName, phone: fam.phone, email: fam.email, isPrimary: true });
    }
    return { ...fam };
  }

  async updateFamilyContact(familyId: string, input: { guardianName?: string; email?: string }): Promise<void> {
    const fam = this.families.get(familyId);
    if (!fam) return;
    if (input.guardianName !== undefined) fam.guardianName = input.guardianName;
    if (input.email !== undefined) fam.email = input.email;
  }

  async upsertFamilySummary(familyId: string, summary: string, lastCallAt: Date): Promise<void> {
    const fam = this.families.get(familyId);
    if (!fam) return;
    fam.summary = summary;
    fam.lastCallAt = lastCallAt;
  }

  async findOrCreateChild(familyId: string, name: string, age: number): Promise<Child> {
    const norm = normalizeName(name);
    const existing = [...this.children.values()].find((c) => c.familyId === familyId && normalizeName(c.name) === norm);
    if (existing) {
      if (existing.age !== age) existing.age = age;
      return { ...existing };
    }
    const id = this.nextId('child');
    const child: Child = { id, familyId, name: name.trim(), age };
    this.children.set(id, child);
    return { ...child };
  }

  async listPrograms(age: number, locationPref?: string): Promise<Program[]> {
    const all = [...this.programs.values()].filter((p) => age >= p.ageMin && age <= p.ageMax);
    if (locationPref) {
      const pref = locationPref.toLowerCase();
      const preferred = all.filter((p) => p.location.toLowerCase().includes(pref));
      const rest = all.filter((p) => !preferred.includes(p));
      return [...preferred, ...rest].slice(0, 3).map((p) => ({ ...p }));
    }
    return all.slice(0, 3).map((p) => ({ ...p }));
  }

  async getProgram(programId: string): Promise<Program | null> {
    const p = this.programs.get(programId);
    return p ? { ...p } : null;
  }

  async listOpenSlots(programId: string, now: Date, limit = 3): Promise<TrialSlot[]> {
    const horizon = now.getTime() + 14 * 86_400_000;
    return [...this.slots.values()]
      .filter((s) => s.programId === programId && s.startsAt.getTime() > now.getTime() && s.startsAt.getTime() <= horizon && s.bookedCount < s.capacity)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, limit)
      .map((s) => ({ ...s }));
  }

  async getSlot(slotId: string): Promise<TrialSlot | null> {
    const s = this.slots.get(slotId);
    return s ? { ...s } : null;
  }

  // Same order as the real transaction: lock slot, return existing (child, slot) booking, capacity
  // check only for a new booking, insert, increment only on insert. No `await` between the check
  // and the insert, so concurrent callers in one process serialize the same way row locks do.
  async bookTrialClass(input: { familyId: string; childId: string; programId: string; slotId: string }): Promise<BookTrialResult> {
    const slot = this.slots.get(input.slotId);
    if (!slot) return { ok: false, reason: 'slot_not_found' };
    const program = this.programs.get(slot.programId);
    if (!program || slot.programId !== input.programId) return { ok: false, reason: 'program_mismatch' };
    const child = this.children.get(input.childId);
    if (!child || child.familyId !== input.familyId) return { ok: false, reason: 'child_not_found' };
    const existing = [...this.bookings.values()].find((b) => b.childId === input.childId && b.slotId === input.slotId);
    if (existing) return { ok: true, booking: { ...existing }, created: false, slot: { ...slot }, program: { ...program }, child: { ...child } };
    if (slot.bookedCount >= slot.capacity) return { ok: false, reason: 'slot_full' };
    const booking: Booking = {
      id: this.nextId('bk'),
      familyId: input.familyId,
      childId: input.childId,
      programId: input.programId,
      slotId: input.slotId,
      status: 'confirmed',
      createdAt: new Date(),
    };
    this.bookings.set(booking.id, booking);
    slot.bookedCount += 1;
    return { ok: true, booking: { ...booking }, created: true, slot: { ...slot }, program: { ...program }, child: { ...child } };
  }

  async getBooking(bookingId: string): Promise<(Booking & { slot: TrialSlot; program: Program; child: Child }) | null> {
    const b = this.bookings.get(bookingId);
    if (!b) return null;
    const slot = this.slots.get(b.slotId);
    const program = this.programs.get(b.programId);
    const child = this.children.get(b.childId);
    if (!slot || !program || !child) return null;
    return { ...b, slot: { ...slot }, program: { ...program }, child: { ...child } };
  }

  async createCallbackRequest(input: { familyId?: string | null; phone?: string | null; reason: string; preferredTime?: string | null }): Promise<CallbackRequest> {
    const cb: CallbackRequest = {
      id: this.nextId('cb'),
      familyId: input.familyId ?? null,
      phone: input.phone ?? null,
      reason: input.reason,
      preferredTime: input.preferredTime ?? null,
      createdAt: new Date(),
    };
    this.callbacks.set(cb.id, cb);
    return { ...cb };
  }

  async addGuardian(input: { familyId: string; name: string; phone?: string | null; email?: string | null }): Promise<Guardian> {
    const g: Guardian = { id: this.nextId('guardian'), familyId: input.familyId, name: input.name, phone: input.phone ?? null, email: input.email ?? null, isPrimary: false };
    this.guardians.set(g.id, g);
    return { ...g };
  }

  async insertCall(input: { direction: CallRecord['direction']; identitySource: CallRecord['identitySource']; phone?: string | null; familyId?: string | null; roomName: string; startedAt: Date }): Promise<CallRecord> {
    const call: CallRecord = {
      id: this.nextId('call'),
      direction: input.direction,
      identitySource: input.identitySource,
      phone: input.phone ?? null,
      familyId: input.familyId ?? null,
      roomName: input.roomName,
      startedAt: input.startedAt,
      endedAt: null,
      outcome: null,
      summary: null,
      transcript: null,
      metrics: null,
      traceId: null,
    };
    this.calls.set(call.id, call);
    return { ...call };
  }

  async finishCall(callId: string, input: { endedAt: Date; outcome: string; summary?: string | null; familyId?: string | null; transcript?: unknown; metrics?: unknown; traceId?: string | null }): Promise<void> {
    const call = this.calls.get(callId);
    if (!call) return;
    call.endedAt = input.endedAt;
    call.outcome = input.outcome;
    if (input.summary !== undefined) call.summary = input.summary;
    if (input.familyId !== undefined) call.familyId = input.familyId;
    if (input.transcript !== undefined) call.transcript = input.transcript;
    if (input.metrics !== undefined) call.metrics = input.metrics;
    if (input.traceId !== undefined) call.traceId = input.traceId;
  }

  async getCall(callId: string): Promise<CallRecord | null> {
    const c = this.calls.get(callId);
    return c ? { ...c } : null;
  }

  async countDemoUsage(input: { now: Date; ipHash?: string | null }): Promise<number> {
    const since = utcDayStart(input.now).getTime();
    return this.demoUsage.filter((r) => r.createdAt.getTime() >= since && (input.ipHash ? r.ipHash === input.ipHash : true)).length;
  }

  // Synchronous between the counts and the push, so concurrent calls cannot overshoot a limit.
  async reserveDemoUsage(input: DemoUsageRequest): Promise<DemoUsageResult> {
    const since = utcDayStart(input.now).getTime();
    const today = this.demoUsage.filter((r) => r.createdAt.getTime() >= since);
    const refused = decideDemoUsage(input, {
      global: today.length,
      ip: input.ipHash ? today.filter((r) => r.ipHash === input.ipHash).length : 0,
    });
    if (refused) return refused;
    const row: DemoUsageRow = { id: this.nextId('usage'), channel: input.channel, ipHash: input.ipHash ?? null, createdAt: input.now };
    this.demoUsage.push(row);
    return { ok: true, id: row.id };
  }
}
