// DbPort: every database side effect the agent can perform. The real adapter (db/index.ts,
// Drizzle + postgres.js) and the in-memory fake (db/fake.ts) implement the same contract with the
// same semantics (PRD section 8). Tools never touch the database any other way.

export type IdentitySource = 'caller_id_only' | 'self_reported';
export type CallDirection = 'inbound' | 'outbound' | 'browser';

export interface Family {
  id: string;
  phone: string | null;
  guardianName: string | null;
  email: string | null;
  summary: string | null;
  lastCallAt: Date | null;
  isDemo: boolean;
  createdAt: Date;
}

export interface Child {
  id: string;
  familyId: string;
  name: string;
  age: number;
}

export interface Guardian {
  id: string;
  familyId: string;
  name: string;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

export interface Program {
  id: string;
  name: string;
  ageMin: number;
  ageMax: number;
  location: string;
  days: string;
  monthlyPriceCents: number;
  description: string;
}

export interface TrialSlot {
  id: string;
  programId: string;
  startsAt: Date;
  coach: string;
  capacity: number;
  bookedCount: number;
}

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  id: string;
  familyId: string;
  childId: string;
  programId: string;
  slotId: string;
  status: BookingStatus;
  createdAt: Date;
}

export interface CallRecord {
  id: string;
  direction: CallDirection;
  identitySource: IdentitySource;
  phone: string | null;
  familyId: string | null;
  roomName: string;
  startedAt: Date;
  endedAt: Date | null;
  outcome: string | null;
  summary: string | null;
  transcript: unknown;
  metrics: unknown;
  traceId: string | null;
}

export interface CallbackRequest {
  id: string;
  familyId: string | null;
  phone: string | null;
  reason: string;
  preferredTime: string | null;
  createdAt: Date;
}

export type BookTrialResult =
  | { ok: true; booking: Booking; created: boolean; slot: TrialSlot; program: Program; child: Child }
  | { ok: false; reason: 'slot_full' | 'slot_not_found' | 'program_mismatch' | 'child_not_found' };

export interface FamilyWithDetails extends Family {
  children: Child[];
  lastBooking: (Booking & { slot: TrialSlot; program: Program; child: Child }) | null;
}

export interface DbPort {
  findFamilyByPhone(phone: string): Promise<FamilyWithDetails | null>;
  findFamilyById(id: string): Promise<FamilyWithDetails | null>;
  createFamily(input: {
    phone?: string | null;
    guardianName?: string | null;
    email?: string | null;
    isDemo?: boolean;
  }): Promise<Family>;
  updateFamilyContact(familyId: string, input: { guardianName?: string; email?: string }): Promise<void>;
  upsertFamilySummary(familyId: string, summary: string, lastCallAt: Date): Promise<void>;
  findOrCreateChild(familyId: string, name: string, age: number): Promise<Child>;
  listPrograms(age: number, locationPref?: string): Promise<Program[]>;
  getProgram(programId: string): Promise<Program | null>;
  listOpenSlots(programId: string, now: Date, limit?: number): Promise<TrialSlot[]>;
  getSlot(slotId: string): Promise<TrialSlot | null>;
  bookTrialClass(input: { familyId: string; childId: string; programId: string; slotId: string }): Promise<BookTrialResult>;
  getBooking(bookingId: string): Promise<(Booking & { slot: TrialSlot; program: Program; child: Child }) | null>;
  createCallbackRequest(input: {
    familyId?: string | null;
    phone?: string | null;
    reason: string;
    preferredTime?: string | null;
  }): Promise<CallbackRequest>;
  addGuardian(input: { familyId: string; name: string; phone?: string | null; email?: string | null }): Promise<Guardian>;
  insertCall(input: {
    direction: CallDirection;
    identitySource: IdentitySource;
    phone?: string | null;
    familyId?: string | null;
    roomName: string;
    startedAt: Date;
  }): Promise<CallRecord>;
  finishCall(
    callId: string,
    input: {
      endedAt: Date;
      outcome: string;
      summary?: string | null;
      familyId?: string | null;
      transcript?: unknown;
      metrics?: unknown;
      traceId?: string | null;
    },
  ): Promise<void>;
  getCall(callId: string): Promise<CallRecord | null>;
}
