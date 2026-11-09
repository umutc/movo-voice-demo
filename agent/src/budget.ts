// Post-call spend tracking for MODEL_PROVIDER=direct: per-call cost rows (provider_spend), the
// monthly budget alerts, and the real Deepgram balance with an automatic pause near zero.
// Runs after the session ended (the caller is gone), bounded by a timeout, and never throws.
// Alerts go through the shared Alerter (db/alerts.ts); budget and balance alerts dedupe once per
// threshold per UTC month through the alerts table (key `<kind>:<month>`).
import type { AlertKind, Alerter } from 'db/alerts';
import { monthKey, type DemoStatePort, type SpendPort, type SpendProvider } from 'db/ops';
import { resolvePrices, type Config } from './config.ts';
import { computeCallCost, type CallCost, type UsageTotals } from './cost.ts';
import type { PinoLike } from './alerts.ts';

export const BUDGET_THRESHOLDS = [50, 80] as const;
export const BALANCE_ALERT_USD = [50, 10] as const;
export const BALANCE_PAUSE_USD = 2;
export const BALANCE_PAUSE_PREFIX = 'deepgram_balance';
/** Longer than any month, so a `<kind>:<month>` key sends once per month. */
export const MONTH_MS = 32 * 24 * 3_600_000;

type AlertSender = Pick<Alerter, 'send'>;

/** Budget alerts the month-to-date spend calls for: every threshold at or above, per provider. */
export function budgetAlertsDue(spend: Record<SpendProvider, number>, budgets: Record<SpendProvider, number>): { kind: AlertKind; provider: SpendProvider; pct: number }[] {
  const out: { kind: AlertKind; provider: SpendProvider; pct: number }[] = [];
  for (const provider of ['openai', 'deepgram'] as const) {
    const budget = budgets[provider];
    if (!(budget > 0)) continue;
    const pct = (spend[provider] / budget) * 100;
    for (const t of BUDGET_THRESHOLDS) if (pct >= t) out.push({ kind: `budget_${provider}_${t}` as AlertKind, provider, pct });
  }
  return out;
}

// ---------- Deepgram balance ----------

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const DEEPGRAM_API = 'https://api.deepgram.com/v1';

/**
 * Reads the Deepgram balance (USD) with a billing:read key: GET /v1/projects for the project id
 * (cached per process), then GET /v1/projects/{id}/balances. Throws on HTTP errors; the caller
 * catches. The key is sent only in the Authorization header and never logged.
 */
export class DeepgramBalance {
  private projectId: string | null = null;
  private readonly key: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(key: string, opts: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.key = key;
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 4000;
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchFn(`${DEEPGRAM_API}${path}`, { headers: { Authorization: `Token ${this.key}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`Deepgram ${path.split('/').slice(0, 2).join('/')} answered HTTP ${res.status}`);
    return res.json();
  }

  async usd(): Promise<number> {
    if (!this.projectId) {
      const body = (await this.get('/projects')) as { projects?: { project_id?: unknown }[] };
      const id = body.projects?.[0]?.project_id;
      if (typeof id !== 'string' || id === '') throw new Error('Deepgram /projects returned no project');
      this.projectId = id;
    }
    const body = (await this.get(`/projects/${this.projectId}/balances`)) as { balances?: { amount?: unknown; units?: unknown }[] };
    const usd = (body.balances ?? []).filter((b) => String(b.units ?? 'usd').toLowerCase() === 'usd').map((b) => Number(b.amount));
    if (usd.length === 0 || usd.some((n) => !Number.isFinite(n))) throw new Error('Deepgram balances had no USD amount');
    return usd.reduce((a, b) => a + b, 0);
  }
}

// One reader per worker process, so the project id lookup happens once.
let sharedBalance: { key: string; reader: DeepgramBalance } | null = null;
function balanceReader(key: string): DeepgramBalance {
  if (!sharedBalance || sharedBalance.key !== key) sharedBalance = { key, reader: new DeepgramBalance(key) };
  return sharedBalance.reader;
}

// ---------- the post-call run ----------

export interface PostCallInput {
  cfg: Pick<
    Config,
    | 'MODEL_PROVIDER'
    | 'LK_STT_MODEL'
    | 'LK_LLM_MODEL'
    | 'LK_TTS_MODEL'
    | 'PRICE_STT_PER_MIN'
    | 'PRICE_TTS_PER_1M_CHARS'
    | 'PRICE_LLM_INPUT_PER_1M'
    | 'PRICE_LLM_CACHED_PER_1M'
    | 'PRICE_LLM_OUTPUT_PER_1M'
    | 'OPENAI_BUDGET_USD'
    | 'DEEPGRAM_BUDGET_USD'
    | 'DEEPGRAM_BILLING_API_KEY'
  >;
  ops: SpendPort & DemoStatePort;
  alerter: AlertSender;
  logger: PinoLike;
  callId: string | null;
  usage: UsageTotals;
  now: Date;
  balance?: Pick<DeepgramBalance, 'usd'> | null;
  timeoutMs?: number;
}

export interface PostCallResult {
  cost: CallCost | null;
  monthSpend: Record<SpendProvider, number> | null;
  balanceUsd: number | null;
  alerts: string[];
  paused: boolean;
  error: string | null;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);
const usd2 = (n: number): string => n.toFixed(2);

async function run(input: PostCallInput, out: PostCallResult): Promise<void> {
  const { cfg, ops, alerter, logger, now } = input;
  const cost = computeCallCost(input.usage, resolvePrices(cfg), cfg.MODEL_PROVIDER);
  out.cost = cost;
  logger.info({ cost }, 'call cost estimate');
  // Inference mode bills the LiveKit credit, not the provider accounts: nothing to track here.
  if (cfg.MODEL_PROVIDER !== 'direct') return;

  const month = monthKey(now);
  const rows: { provider: SpendProvider; usd: number | null; usage: unknown }[] = [
    { provider: 'openai', usd: cost.openai.usd, usage: { ...cost.openai, model: cfg.LK_LLM_MODEL, pricesChecked: cost.pricesChecked } },
    { provider: 'deepgram', usd: cost.deepgram.usd, usage: { ...cost.deepgram, stt: cfg.LK_STT_MODEL, tts: cfg.LK_TTS_MODEL, pricesChecked: cost.pricesChecked } },
  ];
  try {
    for (const r of rows) if (r.usd !== null) await ops.recordSpend({ callId: input.callId, provider: r.provider, month, usd: r.usd, usage: r.usage, now });
    out.monthSpend = await ops.monthSpend(month);
    const budgets = { openai: cfg.OPENAI_BUDGET_USD, deepgram: cfg.DEEPGRAM_BUDGET_USD };
    for (const due of budgetAlertsDue(out.monthSpend, budgets)) {
      const detail = `${due.provider} month ${month}: ${usd2(out.monthSpend[due.provider])} of ${usd2(budgets[due.provider])} USD (${Math.floor(due.pct)} pct)`;
      const outcome = await alerter.send(due.kind, { detail }, { key: `${due.kind}:${month}`, cooldownMs: MONTH_MS });
      out.alerts.push(`${due.kind}:${outcome}`);
    }
  } catch (err) {
    out.error = `spend: ${errText(err)}`;
    logger.warn({ error: out.error }, 'spend tracking failed');
  }

  const reader = input.balance !== undefined ? input.balance : cfg.DEEPGRAM_BILLING_API_KEY ? balanceReader(cfg.DEEPGRAM_BILLING_API_KEY) : null;
  if (!reader) return;
  try {
    const balance = await reader.usd();
    out.balanceUsd = balance;
    logger.info({ deepgramBalanceUsd: balance }, 'deepgram balance');
    for (const t of BALANCE_ALERT_USD) {
      if (balance < t) {
        const kind = `deepgram_balance_${t}` as AlertKind;
        const outcome = await alerter.send(kind, { detail: `balance ${usd2(balance)} USD` }, { key: `${kind}:${month}`, cooldownMs: MONTH_MS });
        out.alerts.push(`${kind}:${outcome}`);
      }
    }
    if (balance < BALANCE_PAUSE_USD) {
      const reason = `${BALANCE_PAUSE_PREFIX}: ${usd2(balance)} USD left (below ${BALANCE_PAUSE_USD})`;
      let note: string | null = null;
      try {
        await ops.setDemoState({ paused: true, reason, now });
        out.paused = true;
        logger.warn({ reason }, 'demo paused automatically');
      } catch (err) {
        note = 'The automatic pause FAILED (database write error). Pause by hand with pnpm demo:pause.';
        logger.warn({ error: errText(err) }, 'automatic pause failed: demo_state not written');
      }
      // Default cooldown, not once a month: a pause after a top-up and a new drop must email again.
      const outcome = await alerter.send('deepgram_balance_2', { detail: reason, note });
      out.alerts.push(`deepgram_balance_2:${outcome}`);
    }
  } catch (err) {
    const msg = `balance: ${errText(err)}`;
    out.error = out.error ? `${out.error}; ${msg}` : msg;
    logger.warn({ error: msg }, 'deepgram balance check failed');
  }
}

/**
 * Cost row, budget alerts and the balance check for one finished call. Resolves within
 * `timeoutMs` (default 10 s) with whatever finished; never rejects.
 */
export async function runPostCallBudget(input: PostCallInput): Promise<PostCallResult> {
  const out: PostCallResult = { cost: null, monthSpend: null, balanceUsd: null, alerts: [], paused: false, error: null };
  const timeoutMs = input.timeoutMs ?? 10_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      out.error = out.error ? `${out.error}; timed out after ${timeoutMs} ms` : `timed out after ${timeoutMs} ms`;
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([
      run(input, out).catch((err: unknown) => {
        out.error = errText(err);
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  return out;
}
