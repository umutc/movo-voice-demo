// Real adapter against TEST_DATABASE_URL (isolated schema). Tables are truncated and reseeded
// before each test. Never runs as part of `pnpm test`.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createDb, type Db } from '../client.ts';
import { DrizzleDb } from '../index.ts';
import { runMigrations } from '../migrate.ts';
import { seedDb, truncateAll } from '../seed.ts';
import * as cases from './booking-semantics.ts';

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
