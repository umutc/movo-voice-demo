// Seed data shared by the real seed script (db/seed.ts) and the in-memory fake (db/fake.ts).
// Everything here is fictional: academy, programs, prices, coaches, families.
// Slots are generated relative to a base date so the "next 14 days" window always has openings.

import type { Program, TrialSlot } from './port.ts';

export const LOCATIONS = {
  prospect: 'Prospect Park, Brooklyn',
  mccarren: 'McCarren Park, Brooklyn',
} as const;

export const PROGRAMS: Program[] = [
  {
    id: 'u6-prospect',
    name: 'Little Kickers U6',
    ageMin: 4,
    ageMax: 5,
    location: LOCATIONS.prospect,
    days: 'Saturday mornings',
    monthlyPriceCents: 9500,
    description: 'Play-based intro to soccer for four and five year olds, forty five minute sessions.',
  },
  {
    id: 'u8-prospect',
    name: 'Juniors U8',
    ageMin: 6,
    ageMax: 7,
    location: LOCATIONS.prospect,
    days: 'Saturday and Wednesday afternoons',
    monthlyPriceCents: 11500,
    description: 'Fundamentals and small-sided games for six and seven year olds, one hour sessions.',
  },
  {
    id: 'u10-mccarren',
    name: 'Academy U10',
    ageMin: 8,
    ageMax: 9,
    location: LOCATIONS.mccarren,
    days: 'Tuesday and Thursday evenings',
    monthlyPriceCents: 12500,
    description: 'Skills, positioning and 7 v 7 matches for eight and nine year olds.',
  },
  {
    id: 'u12-mccarren',
    name: 'Academy U12',
    ageMin: 10,
    ageMax: 11,
    location: LOCATIONS.mccarren,
    days: 'Monday and Wednesday evenings',
    monthlyPriceCents: 13500,
    description: 'Tactical training and 9 v 9 league play for ten and eleven year olds.',
  },
  {
    id: 'u14-prospect',
    name: 'Select U14',
    ageMin: 12,
    ageMax: 14,
    location: LOCATIONS.prospect,
    days: 'Tuesday and Friday evenings',
    monthlyPriceCents: 14500,
    description: 'Competitive 11 v 11 program for twelve to fourteen year olds with match weekends.',
  },
];

// Weekday numbers: 0 Sunday .. 6 Saturday. Times are New York local, written as [hour, minute].
// Each session is one weekday and one time, so a slot always falls on a day the program lists and
// at a time that fits its time of day (morning before noon, afternoon 12 to 5 PM, evening after).
// Each program has a fixed set of one or two coaches; slots take turns between them.
const SLOT_PLAN: Record<string, { sessions: { weekday: number; time: [number, number] }[]; coaches: string[]; capacity: number }> = {
  'u6-prospect': {
    sessions: [
      { weekday: 6, time: [9, 0] },
      { weekday: 6, time: [10, 0] },
    ],
    coaches: ['Coach Mei'],
    capacity: 6,
  },
  'u8-prospect': {
    sessions: [
      { weekday: 3, time: [16, 0] },
      { weekday: 6, time: [14, 0] },
    ],
    coaches: ['Coach Priya', 'Coach Mei'],
    capacity: 6,
  },
  'u10-mccarren': {
    sessions: [
      { weekday: 2, time: [17, 30] },
      { weekday: 4, time: [17, 30] },
    ],
    coaches: ['Coach Luis'],
    capacity: 8,
  },
  'u12-mccarren': {
    sessions: [
      { weekday: 1, time: [18, 0] },
      { weekday: 3, time: [18, 0] },
    ],
    coaches: ['Coach Luis', 'Coach Sam'],
    capacity: 8,
  },
  'u14-prospect': {
    sessions: [
      { weekday: 2, time: [18, 30] },
      { weekday: 5, time: [18, 30] },
    ],
    coaches: ['Coach Rosa'],
    capacity: 10,
  },
};

const NY = 'America/New_York';

/** Offset of America/New_York from UTC in minutes at the given instant (negative, e.g. -300). */
function nyOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Builds a Date for a New York local wall-clock time on a given UTC calendar day. */
export function nyLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = nyOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60_000);
}

function nyDateParts(at: Date): { year: number; month: number; day: number; weekday: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const parts = f.formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), weekday: weekdays.indexOf(get('weekday')) };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Generates 3 to 5 open slots per program within the next 14 days after `from`.
 * Ids are deterministic (`<program>-<yyyy-mm-dd>-<hhmm>`) so fakes and tests can refer to them.
 */
export function generateSlots(from: Date, daysAhead = 14): TrialSlot[] {
  const slots: TrialSlot[] = [];
  for (const program of PROGRAMS) {
    const plan = SLOT_PLAN[program.id];
    if (!plan) continue;
    const perProgram: TrialSlot[] = [];
    for (let d = 1; d <= daysAhead && perProgram.length < 5; d++) {
      const day = new Date(from.getTime() + d * 86_400_000);
      const { year, month, day: dom, weekday } = nyDateParts(day);
      for (const { weekday: wd, time } of plan.sessions) {
        if (wd !== weekday || perProgram.length >= 5) continue;
        const [h, m] = time;
        const startsAt = nyLocal(year, month, dom, h, m);
        const coach = plan.coaches[perProgram.length % plan.coaches.length]!;
        perProgram.push({
          id: `${program.id}-${year}-${pad(month)}-${pad(dom)}-${pad(h)}${pad(m)}`,
          programId: program.id,
          startsAt,
          coach,
          capacity: plan.capacity,
          bookedCount: 0,
        });
      }
    }
    slots.push(...perProgram);
  }
  return slots;
}

export const DEMO_FAMILY = {
  guardianName: 'Jordan Demo',
  email: 'jordan.demo@example.com',
  children: [{ name: 'Emma', age: 7 }],
  summary:
    'Jordan called about a program for Emma, age seven. We discussed Juniors U8 at Prospect Park on Saturday afternoons. Jordan wanted to check the schedule with a partner before booking a trial.',
  priorInquiryReason: 'Asked about Juniors U8 for Emma, wanted to confirm Saturday availability',
} as const;
