// Display formatting for the parent call and done pages. Pure functions, no React, so they are unit tested.
// The agent's tool log lines are short machine summaries (ids, counts); these helpers turn them into
// plain text for the parent without inventing anything: every value shown comes from the log line.

/** One time style for every UI-formatted time: "9:30 AM" (design/parent-done.html). */
export function formatTime(hour24: number, minute: number): string {
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

const NY = 'America/New_York';

/** "9:30 AM" in academy time for an ISO timestamp. */
export function clockTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return formatTime(hour, minute);
}

/** "Wednesday, November 11" in academy time. */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
}

/** "1 program", "2 programs". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Trial slot ids are `<program>-YYYY-MM-DD-HHMM` in academy time (db/seed-data.ts).
 * Returns the program id and "Wed Nov 11, 9:30 AM", or null for any other shape.
 */
export function parseSlotId(slotId: string): { programId: string; when: string } | null {
  const m = /^(.+)-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/.exec(slotId);
  if (!m) return null;
  const [, programId, y, mo, d, hh, mm] = m as unknown as [string, string, string, string, string, string, string];
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), month - 1, day)).getUTCDay()];
  return { programId, when: `${weekday} ${MONTHS[month - 1]} ${day}, ${formatTime(Number(hh), Number(mm))}` };
}

/** "+19294288103" -> "+1 (929) 428-8103". Other shapes come back unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.replace(/[\s()-]/g, ''));
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Short form of a UUID for display: first 8 hex digits, upper case. */
export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export interface ToolLine {
  name: string;
  ok: boolean;
  summary: string;
}

/** Text parts of a tool step. `parts` are joined with ", " and each part never breaks inside. */
export interface ToolStep {
  label: string;
  parts: string[];
}

function proposalParts(summary: string): string[] | null {
  // propose_booking logs `${proposalId} ${programId} ${slotId} ${childName}`.
  const [, programId, slotId, ...name] = summary.split(' ');
  if (!programId || !slotId) return null;
  const slot = parseSlotId(slotId);
  const child = name.join(' ').trim();
  return [child, programId, slot ? slot.when : slotId].filter(Boolean);
}

const LABELS: Record<string, { ok: string; failed: string }> = {
  lookup_programs: { ok: 'Programs looked up', failed: 'Program lookup failed' },
  check_trial_slots: { ok: 'Trial slots checked', failed: 'Slot check failed' },
  propose_booking: { ok: 'Booking read back', failed: 'Booking proposal failed' },
  book_trial_class: { ok: 'Booking written', failed: 'Booking not written' },
  request_human_callback: { ok: 'Callback requested', failed: 'Callback request failed' },
  end_call: { ok: 'Call end requested', failed: 'Call end failed' },
};

function sentenceCase(toolName: string): string {
  const s = toolName.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Readable detail for a tool log line: counts with correct plurals, ids reduced to what a parent can read. */
export function toolDetail(t: ToolLine): string[] {
  if (!t.ok) return t.summary ? [t.summary] : [];
  const s = t.summary;
  switch (t.name) {
    case 'lookup_programs': {
      const m = /^(\d+) programs? for age (\d+)$/.exec(s);
      return m ? [`${plural(Number(m[1]), 'program')} for age ${m[2]}`] : [s];
    }
    case 'check_trial_slots': {
      const m = /^(\d+) slots? for (.+)$/.exec(s);
      return m ? [`${plural(Number(m[1]), 'open slot')}`, m[2]!] : [s];
    }
    case 'propose_booking':
      return proposalParts(s) ?? [s];
    case 'book_trial_class': {
      const m = /^([0-9a-f-]{36})( \(existing\))?$/.exec(s);
      return m ? [`confirmation BK-${shortId(m[1]!)}${m[2] ? ', already booked' : ''}`] : [s];
    }
    case 'request_human_callback':
      return ['request saved for the academy staff'];
    case 'end_call':
      return [];
    default:
      return s ? [s] : [];
  }
}

export function describeTool(t: ToolLine): ToolStep {
  const label = LABELS[t.name]?.[t.ok ? 'ok' : 'failed'] ?? sentenceCase(t.name);
  return { label, parts: toolDetail(t) };
}

/** Proposal summary from the state channel: `${child} · ${programId} · ${slotId}`. */
export function proposalSummaryParts(summary: string | null): string[] {
  if (!summary) return [];
  const parts = summary.split(' · ').map((p) => p.trim());
  return parts.map((p) => parseSlotId(p)?.when ?? p).filter(Boolean);
}

/**
 * Places each tool call under the user turn that triggered it: the last user turn that started at or
 * before the tool finished. Tool calls before any user turn go first. Returns, per transcript index,
 * the tool indexes to show after that line; key -1 holds the ones shown before the first line.
 */
export function attachToolsToTurns(turns: { role: 'agent' | 'user'; at: number }[], toolTimes: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  toolTimes.forEach((at, ti) => {
    let host = -1;
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i]!;
      if (turn.role === 'user' && turn.at <= at) host = i;
    }
    const list = out.get(host) ?? [];
    list.push(ti);
    out.set(host, list);
  });
  return out;
}

/** Offset in whole seconds from the call start, never negative, never past the end. */
export function offsetSeconds(atIso: string, startIso: string | null, maxSeconds: number): number | null {
  if (!startIso) return null;
  const d = Math.round((new Date(atIso).getTime() - new Date(startIso).getTime()) / 1000);
  if (!Number.isFinite(d)) return null;
  return Math.min(Math.max(0, d), maxSeconds);
}

export interface CallMemoryInput {
  call: { identitySource: string; summary: string | null; familyId: string | null; endedAt: string | null };
  family: { isDemo: boolean; summary: string | null } | null;
}

/**
 * What happens to this call's summary, by the agent's rules (agent/src/memory.ts closeCall and
 * agent/src/context.ts bindFamily): the summary is always stored on the call row; it is copied to the
 * family only when a family is bound; the next call reads it only when that family is matched again,
 * which for a browser (`self_reported`) caller happens only for a family flagged `is_demo`, and for a
 * phone (`caller_id_only`) caller by the caller id the family was keyed on.
 */
export function memoryOutcome(v: CallMemoryInput, personaName: string): { familyUpdated: boolean; readBackNextCall: boolean; note: string | null } {
  const summary = v.call.summary;
  if (!summary) return { familyUpdated: false, readBackNextCall: false, note: null };
  const familyUpdated = Boolean(v.call.familyId && v.family && v.family.summary === summary);
  const readBackNextCall = familyUpdated && (v.family!.isDemo || v.call.identitySource === 'caller_id_only');
  if (readBackNextCall) return { familyUpdated, readBackNextCall, note: `Stored on the family record and read back to ${personaName} at the start of the next call.` };
  if (familyUpdated)
    return {
      familyUpdated,
      readBackNextCall,
      note: 'Stored on this call and a new family record for the academy staff. A browser call reopens only the demo family, so the next call starts fresh.',
    };
  return { familyUpdated, readBackNextCall, note: 'Stored on this call for the academy staff. No family record was made, so the next call starts fresh.' };
}
