// Read-only helpers for the web app. Opens a short-lived connection per call; the Next.js dev
// server keeps no pool across hot reloads.
import { and, asc, count, desc, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { createDb } from './client.ts';
import { bookings, callbackRequests, calls, children, families, programs, trialSlots } from './schema.ts';

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

// ---------- Console (read-only tenant console under web/app/console) ----------
// Every helper selects rows only. Shapes stay plain (ISO strings, no Date) so server components
// can pass them straight to client components.

/** Subset of agent/src/metrics-types.ts CallMetricsFile, as stored in calls.metrics. */
export interface CallMetricsJson {
  pipeline?: { stt?: string; llm?: string; tts?: string };
  turns?: {
    e2eMs?: number | null;
    endOfTurnMs?: number | null;
    transcriptionDelayMs?: number | null;
    llmTtftMs?: number | null;
    ttsTtfbMs?: number | null;
    interrupted?: boolean;
  }[];
  interruptions?: number;
}

export interface TranscriptLine {
  role: string;
  text: string;
  interrupted?: boolean;
}

export interface ConsoleCallRow {
  id: string;
  direction: string;
  identitySource: string;
  phone: string | null;
  familyId: string | null;
  guardianName: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
}

export interface ConsoleCallDetail extends ConsoleCallRow {
  roomName: string;
  summary: string | null;
  transcript: TranscriptLine[];
  metrics: CallMetricsJson | null;
  traceId: string | null;
  familyIsDemo: boolean | null;
  children: { name: string; age: number }[];
  booking: { id: string; childName: string; programName: string; startsAt: string } | null;
}

export interface ConsoleCallback {
  id: string;
  phone: string | null;
  reason: string;
  preferredTime: string | null;
  createdAt: string;
  guardianName: string | null;
  call: { id: string; startedAt: string; excerpt: TranscriptLine[] } | null;
}

export interface ConsoleSlot {
  id: string;
  programId: string;
  programName: string;
  location: string;
  startsAt: string;
  coach: string;
  capacity: number;
  bookedCount: number;
}

export interface ConsoleProgram {
  id: string;
  name: string;
  ageMin: number;
  ageMax: number;
  location: string;
  days: string;
  monthlyPriceCents: number;
}

export interface ConsoleFamily {
  id: string;
  guardianName: string | null;
  phone: string | null;
  isDemo: boolean;
  summary: string | null;
  lastCallAt: string | null;
  children: { name: string; age: number }[];
  calls: { id: string; direction: string; identitySource: string; startedAt: string; endedAt: string | null; outcome: string | null }[];
  bookings: { id: string; childName: string; programName: string; location: string; startsAt: string; coach: string }[];
}

function asTranscript(v: unknown): TranscriptLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is TranscriptLine => typeof x === 'object' && x !== null && typeof (x as TranscriptLine).role === 'string' && typeof (x as TranscriptLine).text === 'string',
  );
}

function toCallRow(call: typeof calls.$inferSelect, guardianName: string | null): ConsoleCallRow {
  return {
    id: call.id,
    direction: call.direction,
    identitySource: call.identitySource,
    phone: call.phone,
    familyId: call.familyId,
    guardianName,
    startedAt: call.startedAt.toISOString(),
    endedAt: call.endedAt?.toISOString() ?? null,
    outcome: call.outcome,
  };
}

/** Calls newest first, optionally only those started at or after `since`. */
export async function listConsoleCalls(url: string, opts: { since?: Date; limit?: number } = {}): Promise<ConsoleCallRow[]> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const rows = await db
      .select({ call: calls, guardianName: families.guardianName })
      .from(calls)
      .leftJoin(families, eq(calls.familyId, families.id))
      .where(opts.since ? gte(calls.startedAt, opts.since) : undefined)
      .orderBy(desc(calls.startedAt))
      .limit(opts.limit ?? 500);
    return rows.map((r) => toCallRow(r.call, r.guardianName));
  } finally {
    await close();
  }
}

export async function getConsoleCall(url: string, callId: string): Promise<ConsoleCallDetail | null> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [row] = await db
      .select({ call: calls, family: families })
      .from(calls)
      .leftJoin(families, eq(calls.familyId, families.id))
      .where(eq(calls.id, callId))
      .limit(1);
    if (!row) return null;
    const { call, family } = row;
    let kids: { name: string; age: number }[] = [];
    let booking: ConsoleCallDetail['booking'] = null;
    if (call.familyId) {
      kids = await db.select({ name: children.name, age: children.age }).from(children).where(eq(children.familyId, call.familyId));
      // Same rule as getCallView: a booking counts for this call when it was created during it.
      const end = call.endedAt ?? new Date(call.startedAt.getTime() + 30 * 60_000);
      const [b] = await db
        .select({ id: bookings.id, childName: children.name, programName: programs.name, startsAt: trialSlots.startsAt })
        .from(bookings)
        .innerJoin(children, eq(bookings.childId, children.id))
        .innerJoin(programs, eq(bookings.programId, programs.id))
        .innerJoin(trialSlots, eq(bookings.slotId, trialSlots.id))
        .where(
          and(
            eq(bookings.familyId, call.familyId),
            gte(bookings.createdAt, new Date(call.startedAt.getTime() - 5_000)),
            lte(bookings.createdAt, new Date(end.getTime() + 60_000)),
          ),
        )
        .orderBy(desc(bookings.createdAt))
        .limit(1);
      if (b) booking = { ...b, startsAt: b.startsAt.toISOString() };
    }
    return {
      ...toCallRow(call, family?.guardianName ?? null),
      roomName: call.roomName,
      summary: call.summary,
      transcript: asTranscript(call.transcript),
      metrics: (call.metrics as CallMetricsJson | null) ?? null,
      traceId: call.traceId,
      familyIsDemo: family?.isDemo ?? null,
      children: kids,
      booking,
    };
  } finally {
    await close();
  }
}

/** calls.metrics for every call that has it (latency and interruptions on the Quality page). */
export async function listCallMetrics(url: string): Promise<{ id: string; startedAt: string; metrics: CallMetricsJson }[]> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const rows = await db
      .select({ id: calls.id, startedAt: calls.startedAt, metrics: calls.metrics })
      .from(calls)
      .where(isNotNull(calls.metrics))
      .orderBy(desc(calls.startedAt));
    return rows.map((r) => ({ id: r.id, startedAt: r.startedAt.toISOString(), metrics: r.metrics as CallMetricsJson }));
  } finally {
    await close();
  }
}

/** Pipeline the agent recorded on its most recent call that has metrics, with that call's start time. */
export async function getLatestPipeline(url: string): Promise<{ startedAt: string; pipeline: { stt: string | null; llm: string | null; tts: string | null } } | null> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [row] = await db
      .select({ startedAt: calls.startedAt, metrics: calls.metrics })
      .from(calls)
      .where(isNotNull(calls.metrics))
      .orderBy(desc(calls.startedAt))
      .limit(1);
    const p = (row?.metrics as CallMetricsJson | null | undefined)?.pipeline;
    if (!row || !p) return null;
    return { startedAt: row.startedAt.toISOString(), pipeline: { stt: p.stt ?? null, llm: p.llm ?? null, tts: p.tts ?? null } };
  } finally {
    await close();
  }
}

/** Every callback request on record. There is no status column, so this is not a "waiting" count. */
export async function countCallbacks(url: string): Promise<number> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [r] = await db.select({ n: count() }).from(callbackRequests);
    return r?.n ?? 0;
  } finally {
    await close();
  }
}

/**
 * Callback queue, newest first. The creating call is the call whose time span holds the request
 * and whose transcript has a request_human_callback tool call; family or phone breaks ties.
 */
export async function listConsoleCallbacks(url: string): Promise<ConsoleCallback[]> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const rows = await db
      .select({ cb: callbackRequests, guardianName: families.guardianName })
      .from(callbackRequests)
      .leftJoin(families, eq(callbackRequests.familyId, families.id))
      .orderBy(desc(callbackRequests.createdAt));
    if (rows.length === 0) return [];
    const times = rows.map((r) => r.cb.createdAt.getTime());
    const candidates = await db
      .select({ call: calls, guardianName: families.guardianName })
      .from(calls)
      .leftJoin(families, eq(calls.familyId, families.id))
      .where(and(gte(calls.startedAt, new Date(Math.min(...times) - 2 * 3600_000)), lte(calls.startedAt, new Date(Math.max(...times) + 5_000))));
    return rows.map(({ cb, guardianName }) => {
      const t = cb.createdAt.getTime();
      let best: { score: number; call: (typeof candidates)[number]['call']; guardianName: string | null } | null = null;
      for (const c of candidates) {
        const start = c.call.startedAt.getTime() - 5_000;
        const end = (c.call.endedAt?.getTime() ?? c.call.startedAt.getTime() + 30 * 60_000) + 5_000;
        if (t < start || t > end) continue;
        const lines = asTranscript(c.call.transcript);
        let score = 1;
        if (lines.some((l) => l.role === 'tool_call' && l.text.startsWith('request_human_callback'))) score += 4;
        if (cb.familyId && c.call.familyId === cb.familyId) score += 2;
        if (cb.phone && c.call.phone === cb.phone) score += 2;
        if (!best || score > best.score) best = { score, call: c.call, guardianName: c.guardianName };
      }
      let call: ConsoleCallback['call'] = null;
      if (best) {
        const lines = asTranscript(best.call.transcript);
        const idx = lines.findIndex((l) => l.role === 'tool_call' && l.text.startsWith('request_human_callback'));
        let excerpt: TranscriptLine[] = [];
        if (idx >= 0) {
          const spoken = lines.slice(0, idx).filter((l) => l.role === 'user' || l.role === 'assistant');
          excerpt = [...spoken.slice(-2), lines[idx]!];
        }
        call = { id: best.call.id, startedAt: best.call.startedAt.toISOString(), excerpt };
      }
      return {
        id: cb.id,
        phone: cb.phone,
        reason: cb.reason,
        preferredTime: cb.preferredTime,
        createdAt: cb.createdAt.toISOString(),
        guardianName: guardianName ?? best?.guardianName ?? null,
        call,
      };
    });
  } finally {
    await close();
  }
}

export async function listConsolePrograms(url: string): Promise<ConsoleProgram[]> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    return await db.select().from(programs).orderBy(asc(programs.ageMin));
  } finally {
    await close();
  }
}

/** Trial slots starting in [from, to), soonest first, with the program name and location. */
export async function listConsoleSlots(url: string, from: Date, to: Date): Promise<ConsoleSlot[]> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const rows = await db
      .select({ slot: trialSlots, programName: programs.name, location: programs.location })
      .from(trialSlots)
      .innerJoin(programs, eq(trialSlots.programId, programs.id))
      .where(and(gte(trialSlots.startsAt, from), lt(trialSlots.startsAt, to)))
      .orderBy(asc(trialSlots.startsAt));
    return rows.map((r) => ({
      id: r.slot.id,
      programId: r.slot.programId,
      programName: r.programName,
      location: r.location,
      startsAt: r.slot.startsAt.toISOString(),
      coach: r.slot.coach,
      capacity: r.slot.capacity,
      bookedCount: r.slot.bookedCount,
    }));
  } finally {
    await close();
  }
}

export async function listConsoleFamilies(url: string): Promise<ConsoleFamily[]> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const fams = await db.select().from(families).orderBy(sql`${families.lastCallAt} desc nulls last`, desc(families.createdAt));
    const kids = await db.select().from(children);
    const callRows = await db
      .select({ id: calls.id, familyId: calls.familyId, direction: calls.direction, identitySource: calls.identitySource, startedAt: calls.startedAt, endedAt: calls.endedAt, outcome: calls.outcome })
      .from(calls)
      .where(isNotNull(calls.familyId))
      .orderBy(desc(calls.startedAt));
    const bookingRows = await db
      .select({ id: bookings.id, familyId: bookings.familyId, childName: children.name, programName: programs.name, location: programs.location, startsAt: trialSlots.startsAt, coach: trialSlots.coach })
      .from(bookings)
      .innerJoin(children, eq(bookings.childId, children.id))
      .innerJoin(programs, eq(bookings.programId, programs.id))
      .innerJoin(trialSlots, eq(bookings.slotId, trialSlots.id))
      .where(eq(bookings.status, 'confirmed'))
      .orderBy(desc(bookings.createdAt));
    return fams.map((f) => ({
      id: f.id,
      guardianName: f.guardianName,
      phone: f.phone,
      isDemo: f.isDemo,
      summary: f.summary,
      lastCallAt: f.lastCallAt?.toISOString() ?? null,
      children: kids.filter((k) => k.familyId === f.id).map((k) => ({ name: k.name, age: k.age })),
      calls: callRows
        .filter((c) => c.familyId === f.id)
        .map((c) => ({ id: c.id, direction: c.direction, identitySource: c.identitySource, startedAt: c.startedAt.toISOString(), endedAt: c.endedAt?.toISOString() ?? null, outcome: c.outcome })),
      bookings: bookingRows
        .filter((b) => b.familyId === f.id)
        .map((b) => ({ id: b.id, childName: b.childName, programName: b.programName, location: b.location, startsAt: b.startsAt.toISOString(), coach: b.coach })),
    }));
  } finally {
    await close();
  }
}

export interface HomeProgram {
  id: string;
  name: string;
  ageMin: number;
  ageMax: number;
  location: string;
  days: string;
  monthlyPriceCents: number;
  /** Soonest future trial slot with a free seat, or null. */
  nextOpenSlot: { startsAt: string; seatsLeft: number } | null;
}

export interface HomeCoach {
  name: string;
  programs: string[];
}

export interface HomeCatalog {
  programs: HomeProgram[];
  coaches: HomeCoach[];
}

/** Programs and coaches for the parent home page. Coaches are the distinct names on upcoming trial slots. */
export async function getHomeCatalog(url: string, now: Date = new Date()): Promise<HomeCatalog> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [programRows, slotRows] = await Promise.all([
      db.select().from(programs).orderBy(asc(programs.ageMin), asc(programs.name)),
      db
        .select({ programId: trialSlots.programId, startsAt: trialSlots.startsAt, coach: trialSlots.coach, capacity: trialSlots.capacity, bookedCount: trialSlots.bookedCount })
        .from(trialSlots)
        .where(gte(trialSlots.startsAt, now))
        .orderBy(asc(trialSlots.startsAt)),
    ]);
    const nameById = new Map(programRows.map((p) => [p.id, p.name]));
    const coachPrograms = new Map<string, Set<string>>();
    for (const s of slotRows) {
      const name = nameById.get(s.programId);
      if (!name) continue;
      const set = coachPrograms.get(s.coach) ?? new Set<string>();
      set.add(name);
      coachPrograms.set(s.coach, set);
    }
    return {
      programs: programRows.map((p) => {
        const next = slotRows.find((s) => s.programId === p.id && s.bookedCount < s.capacity);
        return {
          id: p.id,
          name: p.name,
          ageMin: p.ageMin,
          ageMax: p.ageMax,
          location: p.location,
          days: p.days,
          monthlyPriceCents: p.monthlyPriceCents,
          nextOpenSlot: next ? { startsAt: next.startsAt.toISOString(), seatsLeft: next.capacity - next.bookedCount } : null,
        };
      }),
      coaches: [...coachPrograms.entries()]
        .map(([name, set]) => ({ name, programs: [...set].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally {
    await close();
  }
}
