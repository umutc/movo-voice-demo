// Operations state shared by the agent, the web token route and the scripts: the pause switch row
// (demo_state) and the alert log (alerts) the cooldown dedupe reads. Separate from DbPort so the
// enrollment tools never see it.
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { createDb, type Db } from './client.ts';
import { alerts, demoState, providerSpend } from './schema.ts';

export interface DemoState {
  paused: boolean;
  reason: string | null;
  updatedAt: Date | null;
}

export interface DemoStatePort {
  getDemoState(): Promise<DemoState>;
  setDemoState(input: { paused: boolean; reason?: string | null; now: Date }): Promise<DemoState>;
}

export interface AlertLogPort {
  /**
   * Records an alert of `kind` unless one was recorded in the last `cooldownMs`. Returns true when
   * the caller may send the email (a row was written), false when it is a duplicate.
   */
  claimAlert(input: { kind: string; detail: string | null; now: Date; cooldownMs: number }): Promise<boolean>;
  /**
   * Removes the row a successful claim wrote (same kind and time), so a failed send does not block
   * the cooldown and the next attempt can send again.
   */
  releaseAlert(input: { kind: string; now: Date }): Promise<void>;
}

export type SpendProvider = 'openai' | 'deepgram';

export interface SpendPort {
  /** Records one call's estimated cost for a provider. Idempotent per call and provider. */
  recordSpend(input: { callId: string | null; provider: SpendProvider; month: string; usd: number; usage: unknown; now: Date }): Promise<void>;
  /** Month-to-date estimated cost per provider for a UTC month ('2026-11'). */
  monthSpend(month: string): Promise<Record<SpendProvider, number>>;
}

/** The UTC month key the budget sums over: '2026-11'. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export const NOT_PAUSED: DemoState = { paused: false, reason: null, updatedAt: null };
export const REASON_MAX = 120;

/** Trims a pause reason to one short line. Empty means no reason. */
export function cleanReason(reason: string | null | undefined): string | null {
  const r = (reason ?? '').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
  return r === '' ? null : r;
}

export class DrizzleOps implements DemoStatePort, AlertLogPort, SpendPort {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  async getDemoState(): Promise<DemoState> {
    const [row] = await this.db.select().from(demoState).where(eq(demoState.id, 1)).limit(1);
    return row ? { paused: row.paused, reason: row.reason, updatedAt: row.updatedAt } : NOT_PAUSED;
  }

  async setDemoState(input: { paused: boolean; reason?: string | null; now: Date }): Promise<DemoState> {
    const values = { paused: input.paused, reason: cleanReason(input.reason), updatedAt: input.now };
    const [row] = await this.db
      .insert(demoState)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: demoState.id, set: values })
      .returning();
    if (!row) throw new Error('upsert demo_state returned no row');
    return { paused: row.paused, reason: row.reason, updatedAt: row.updatedAt };
  }

  // A transaction-scoped advisory lock per kind makes check-then-insert atomic, so two workers that
  // hit the same error at once still send one email. Works through the transaction pooler.
  async claimAlert(input: { kind: string; detail: string | null; now: Date; cooldownMs: number }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`alerts:${input.kind}`}))`);
      const since = new Date(input.now.getTime() - input.cooldownMs);
      const [recent] = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(and(eq(alerts.kind, input.kind), gt(alerts.sentAt, since)))
        .orderBy(desc(alerts.sentAt))
        .limit(1);
      if (recent) return false;
      await tx.insert(alerts).values({ kind: input.kind, detail: input.detail, sentAt: input.now });
      return true;
    });
  }

  async releaseAlert(input: { kind: string; now: Date }): Promise<void> {
    await this.db.delete(alerts).where(and(eq(alerts.kind, input.kind), eq(alerts.sentAt, input.now)));
  }

  async recordSpend(input: { callId: string | null; provider: SpendProvider; month: string; usd: number; usage: unknown; now: Date }): Promise<void> {
    await this.db
      .insert(providerSpend)
      .values({ callId: input.callId, provider: input.provider, month: input.month, usd: input.usd, usage: input.usage, createdAt: input.now })
      .onConflictDoNothing();
  }

  async monthSpend(month: string): Promise<Record<SpendProvider, number>> {
    const rows = await this.db
      .select({ provider: providerSpend.provider, usd: sql<number>`coalesce(sum(${providerSpend.usd}), 0)::float8` })
      .from(providerSpend)
      .where(eq(providerSpend.month, month))
      .groupBy(providerSpend.provider);
    const out: Record<SpendProvider, number> = { openai: 0, deepgram: 0 };
    for (const r of rows) if (r.provider === 'openai' || r.provider === 'deepgram') out[r.provider] = Number(r.usd);
    return out;
  }
}

/** Opens a short-lived connection for the ops helpers (scripts). */
export function openOps(url: string | undefined): { ops: DrizzleOps; close: () => Promise<void> } {
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, close } = createDb(url, { max: 1 });
  return { ops: new DrizzleOps(db), close };
}

/** In-memory ops for tests. Set `down` to make every call reject like an unreachable database. */
export class FakeOps implements DemoStatePort, AlertLogPort, SpendPort {
  state: DemoState = NOT_PAUSED;
  alerts: { kind: string; detail: string | null; sentAt: Date }[] = [];
  spend: { callId: string | null; provider: SpendProvider; month: string; usd: number; usage: unknown }[] = [];
  down = false;

  private check(): void {
    if (this.down) throw new Error('database unreachable (fake)');
  }

  async getDemoState(): Promise<DemoState> {
    this.check();
    return this.state;
  }

  async setDemoState(input: { paused: boolean; reason?: string | null; now: Date }): Promise<DemoState> {
    this.check();
    this.state = { paused: input.paused, reason: cleanReason(input.reason), updatedAt: input.now };
    return this.state;
  }

  async claimAlert(input: { kind: string; detail: string | null; now: Date; cooldownMs: number }): Promise<boolean> {
    this.check();
    const since = input.now.getTime() - input.cooldownMs;
    if (this.alerts.some((a) => a.kind === input.kind && a.sentAt.getTime() > since)) return false;
    this.alerts.push({ kind: input.kind, detail: input.detail, sentAt: input.now });
    return true;
  }

  async releaseAlert(input: { kind: string; now: Date }): Promise<void> {
    this.check();
    this.alerts = this.alerts.filter((a) => !(a.kind === input.kind && a.sentAt.getTime() === input.now.getTime()));
  }

  async recordSpend(input: { callId: string | null; provider: SpendProvider; month: string; usd: number; usage: unknown; now: Date }): Promise<void> {
    this.check();
    if (input.callId && this.spend.some((s) => s.callId === input.callId && s.provider === input.provider)) return;
    this.spend.push({ callId: input.callId, provider: input.provider, month: input.month, usd: input.usd, usage: input.usage });
  }

  async monthSpend(month: string): Promise<Record<SpendProvider, number>> {
    this.check();
    const out: Record<SpendProvider, number> = { openai: 0, deepgram: 0 };
    for (const s of this.spend) if (s.month === month) out[s.provider] += s.usd;
    return out;
  }
}

/** Reads the pause row on a short-lived connection (web home page). */
export async function readDemoState(url: string): Promise<DemoState> {
  const { ops, close } = openOps(url);
  try {
    return await ops.getDemoState();
  } finally {
    await close();
  }
}
