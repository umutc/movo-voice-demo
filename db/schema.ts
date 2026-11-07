// Drizzle schema per PRD section 8. No pgEnum: enum types are schema-qualified in generated SQL
// and would break the isolated `test` schema. Enumerated columns are text, typed in db/port.ts.
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const families = pgTable(
  'families',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phone: text('phone'),
    guardianName: text('guardian_name'),
    email: text('email'),
    summary: text('summary'),
    lastCallAt: timestamp('last_call_at', { withTimezone: true }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('families_phone_unique').on(t.phone)],
);

export const children = pgTable(
  'children',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    age: integer('age').notNull(),
  },
  (t) => [index('children_family_idx').on(t.familyId)],
);

export const guardians = pgTable(
  'guardians',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [index('guardians_family_idx').on(t.familyId)],
);

export const programs = pgTable('programs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ageMin: integer('age_min').notNull(),
  ageMax: integer('age_max').notNull(),
  location: text('location').notNull(),
  days: text('days').notNull(),
  monthlyPriceCents: integer('monthly_price_cents').notNull(),
  description: text('description').notNull(),
});

export const trialSlots = pgTable(
  'trial_slots',
  {
    id: text('id').primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    coach: text('coach').notNull(),
    capacity: integer('capacity').notNull(),
    bookedCount: integer('booked_count').notNull().default(0),
  },
  (t) => [index('trial_slots_program_starts_idx').on(t.programId, t.startsAt)],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id),
    slotId: text('slot_id')
      .notNull()
      .references(() => trialSlots.id),
    status: text('status').notNull().default('confirmed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('bookings_child_slot_unique').on(t.childId, t.slotId), index('bookings_family_idx').on(t.familyId)],
);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    direction: text('direction').notNull(),
    identitySource: text('identity_source').notNull(),
    phone: text('phone'),
    familyId: uuid('family_id').references(() => families.id, { onDelete: 'set null' }),
    roomName: text('room_name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    outcome: text('outcome'),
    summary: text('summary'),
    transcript: jsonb('transcript'),
    metrics: jsonb('metrics'),
    traceId: text('trace_id'),
  },
  (t) => [index('calls_family_idx').on(t.familyId), index('calls_started_idx').on(t.startedAt)],
);

export const callbackRequests = pgTable('callback_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id').references(() => families.id, { onDelete: 'set null' }),
  phone: text('phone'),
  reason: text('reason').notNull(),
  preferredTime: text('preferred_time'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per admitted demo call (browser token minted or phone call answered). Counted per UTC
// day to cap spend on the public demo. `ip_hash` is an HMAC of the client IP, never the raw IP.
export const demoUsage = pgTable(
  'demo_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channel: text('channel').notNull(),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('demo_usage_created_idx').on(t.createdAt), index('demo_usage_ip_created_idx').on(t.ipHash, t.createdAt)],
).enableRLS();
