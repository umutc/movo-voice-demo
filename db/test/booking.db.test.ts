// Real adapter against TEST_DATABASE_URL (isolated schema). Tables are truncated and reseeded
// before each test. Never runs as part of `pnpm test`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.ts';
import { DrizzleDb } from '../index.ts';
import { DrizzleOps } from '../ops.ts';
import { runMigrations } from '../migrate.ts';
import { seedDb, truncateAll } from '../seed.ts';
import * as cases from './booking-semantics.ts';
import * as usage from './usage-semantics.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required for pnpm test:db');
if (!/search_path(=|%3D)test/.test(url)) throw new Error('TEST_DATABASE_URL must select the isolated test schema');

const DEMO = '+15555550100';
let db: Db;
let close: () => Promise<void>;
let h: cases.Harness;

beforeAll(async () => {
  await runMigrations(url, 'test');
  const c = createDb(url, { max: 4 });
  db = c.db;
  close = c.close;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
  const now = new Date();
  await seedDb(db, { now, demoPhone: DEMO });
  h = { port: new DrizzleDb(db), now };
});

describe('DrizzleDb booking semantics (real Postgres, test schema)', () => {
  it('two concurrent requests for the last seat produce one booking and booked_count == capacity', () => cases.lastSeatIsBookedOnce(h));
  it('a repeated request on a full slot returns the original booking', () => cases.repeatOnFullSlotReturnsOriginal(h));
  it('a different child on a full slot is refused', () => cases.differentChildOnFullSlotRefused(h));
  it('findOrCreateChild is stable for the same normalized name', () => cases.findOrCreateChildIsStable(h));
  it('two siblings can share a slot while capacity allows', () => cases.siblingsShareASlot(h));
  it('seed data: demo family, programs by age', () => cases.demoFamilyIsSeeded(h, DEMO));
});

describe('DrizzleDb demo usage caps', () => {
  it('the per-IP limit refuses the third call from one IP only', () => usage.perIpLimitRefusesThirdCall(h));
  it('the global limit counts web and phone calls together', () => usage.globalLimitCountsWebAndPhone(h));
  it('a limit of 0 or no limit admits every call', () => usage.zeroOrMissingLimitIsOff(h));
  it('calls from the previous UTC day do not count', () => usage.yesterdayDoesNotCount(h));
  it('concurrent reservations stop exactly at the limit', () => usage.concurrentReservationsStopAtLimit(h));
});

describe('DrizzleOps pause row and alert dedupe', () => {
  it('no row reads as not paused; pause and resume upsert the single row', async () => {
    const ops = new DrizzleOps(db);
    expect(await ops.getDemoState()).toEqual({ paused: false, reason: null, updatedAt: null });
    const at = new Date('2026-11-09T12:00:00Z');
    expect(await ops.setDemoState({ paused: true, reason: ' provider_credit: 429 ', now: at })).toEqual({ paused: true, reason: 'provider_credit: 429', updatedAt: at });
    expect((await ops.setDemoState({ paused: false, reason: null, now: at })).paused).toBe(false);
    expect((await ops.getDemoState()).reason).toBeNull();
  });

  it('claimAlert writes once per kind per cooldown, also under concurrency', async () => {
    const ops = new DrizzleOps(db);
    const now = new Date('2026-11-09T12:00:00Z');
    const hour = 3_600_000;
    const claims = await Promise.all(Array.from({ length: 6 }, () => ops.claimAlert({ kind: 'fail_closed', detail: 'test', now, cooldownMs: 6 * hour })));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await ops.claimAlert({ kind: 'daily_limit', detail: null, now, cooldownMs: 6 * hour })).toBe(true);
    expect(await ops.claimAlert({ kind: 'fail_closed', detail: null, now: new Date(now.getTime() + 5 * hour), cooldownMs: 6 * hour })).toBe(false);
    expect(await ops.claimAlert({ kind: 'fail_closed', detail: null, now: new Date(now.getTime() + 6 * hour + 1), cooldownMs: 6 * hour })).toBe(true);
  });
});
