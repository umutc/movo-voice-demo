import { describe, expect, it } from 'vitest';
import { attachToolsToTurns, clockTime, describeTool, formatPhone, memoryOutcome, offsetSeconds, parseSlotId, proposalSummaryParts } from './call-format.ts';

describe('call-format', () => {
  it('formats phones and times', () => {
    expect(formatPhone('+19294288103')).toBe('+1 (929) 428-8103');
    expect(formatPhone('+442071234567')).toBe('+442071234567');
    expect(clockTime('2026-11-11T14:30:00.000Z')).toBe('9:30 AM');
    expect(parseSlotId('u8-prospect-2026-11-11-0930')).toEqual({ programId: 'u8-prospect', when: 'Wed Nov 11, 9:30 AM' });
    expect(parseSlotId('u8-prospect-2026-11-11-1600')?.when).toBe('Wed Nov 11, 4:00 PM');
    expect(parseSlotId('weird')).toBeNull();
  });

  it('describes tool lines without raw ids and with plurals', () => {
    expect(describeTool({ name: 'lookup_programs', ok: true, summary: '1 programs for age 7' })).toEqual({ label: 'Programs looked up', parts: ['1 program for age 7'] });
    expect(describeTool({ name: 'check_trial_slots', ok: true, summary: '2 slots for u8-prospect' }).parts).toEqual(['2 open slots', 'u8-prospect']);
    expect(describeTool({ name: 'propose_booking', ok: true, summary: 'prop-1 u8-prospect u8-prospect-2026-11-11-0930 Emma' }).parts).toEqual([
      'Emma',
      'u8-prospect',
      'Wed Nov 11, 9:30 AM',
    ]);
    expect(describeTool({ name: 'book_trial_class', ok: true, summary: '1be9adc5-0000-4000-8000-000000000000' }).parts).toEqual(['confirmation BK-1BE9ADC5']);
    expect(describeTool({ name: 'end_call', ok: true, summary: 'requested' })).toEqual({ label: 'Call end requested', parts: [] });
    expect(describeTool({ name: 'new_tool', ok: true, summary: 'x' }).label).toBe('New tool');
    expect(proposalSummaryParts('Emma · u8-prospect · u8-prospect-2026-11-11-0930')).toEqual(['Emma', 'u8-prospect', 'Wed Nov 11, 9:30 AM']);
  });

  it('puts each tool under the user turn before it', () => {
    const turns = [
      { role: 'agent' as const, at: 0 },
      { role: 'user' as const, at: 10 },
      { role: 'agent' as const, at: 20 },
      { role: 'user' as const, at: 30 },
    ];
    const m = attachToolsToTurns(turns, [5, 15, 25, 35]);
    expect(m.get(-1)).toEqual([0]);
    expect(m.get(1)).toEqual([1, 2]);
    expect(m.get(3)).toEqual([3]);
  });

  it('offsets tool times from the call start', () => {
    expect(offsetSeconds('2026-11-07T12:00:33.400Z', '2026-11-07T12:00:00.000Z', 34)).toBe(33);
    expect(offsetSeconds('2026-11-07T12:01:00.000Z', '2026-11-07T12:00:00.000Z', 34)).toBe(34);
    expect(offsetSeconds('2026-11-07T12:00:00.000Z', null, 34)).toBeNull();
  });

  it('says read back next call only when the agent would read it back', () => {
    const base = { identitySource: 'self_reported', summary: 'S', familyId: 'f', endedAt: 'x' };
    expect(memoryOutcome({ call: base, family: { isDemo: true, summary: 'S' } }, 'Maya').readBackNextCall).toBe(true);
    const fresh = memoryOutcome({ call: base, family: { isDemo: false, summary: 'S' } }, 'Maya');
    expect(fresh).toMatchObject({ familyUpdated: true, readBackNextCall: false });
    expect(fresh.note).not.toContain('read back');
    expect(memoryOutcome({ call: { ...base, familyId: null }, family: null }, 'Maya')).toMatchObject({ familyUpdated: false, readBackNextCall: false });
    expect(memoryOutcome({ call: { ...base, identitySource: 'caller_id_only' }, family: { isDemo: false, summary: 'S' } }, 'Maya').readBackNextCall).toBe(true);
    expect(memoryOutcome({ call: { ...base, summary: null }, family: null }, 'Maya').note).toBeNull();
  });
});
