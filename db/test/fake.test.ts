import { beforeEach, describe, it } from 'vitest';
import { FakeDb } from '../fake.ts';
import * as cases from './booking-semantics.ts';
import * as usage from './usage-semantics.ts';

const DEMO = '+15555550100';
let h: cases.Harness;

beforeEach(() => {
  h = { port: new FakeDb({ demoPhone: DEMO }), now: new Date() };
});

describe('FakeDb booking semantics', () => {
  it('two concurrent requests for the last seat produce one booking', () => cases.lastSeatIsBookedOnce(h));
  it('a repeated request on a full slot returns the original booking', () => cases.repeatOnFullSlotReturnsOriginal(h));
  it('a different child on a full slot is refused', () => cases.differentChildOnFullSlotRefused(h));
  it('findOrCreateChild is stable for the same normalized name', () => cases.findOrCreateChildIsStable(h));
  it('two siblings can share a slot while capacity allows', () => cases.siblingsShareASlot(h));
  it('seed data: demo family, programs by age', () => cases.demoFamilyIsSeeded(h, DEMO));
});

describe('FakeDb demo usage caps', () => {
  it('the per-IP limit refuses the third call from one IP only', () => usage.perIpLimitRefusesThirdCall(h));
  it('the global limit counts web and phone calls together', () => usage.globalLimitCountsWebAndPhone(h));
  it('a limit of 0 or no limit admits every call', () => usage.zeroOrMissingLimitIsOff(h));
  it('calls from the previous UTC day do not count', () => usage.yesterdayDoesNotCount(h));
  it('concurrent reservations stop exactly at the limit', () => usage.concurrentReservationsStopAtLimit(h));
});
