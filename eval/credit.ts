// Inference credit guard for the eval. A 429 or quota error from LiveKit Inference (for example
// MaxGatewayCredits) is not an agent failure: the run stops, exits nonzero, and writes an aborted
// marker instead of a scorecard. The SDK retries a 429 and then throws a generic "failed after N
// attempts" error, so the guard also listens to each LLM's "error" event, which carries the
// original status error. The classification lives in agent/src/provider-errors.ts (shared with the
// agent's automatic pause).
import { writeFileSync } from 'node:fs';
import type { llm } from '@livekit/agents';
import { creditDetail as detail, isCreditError as isProviderCreditError } from 'agent/src/provider-errors.ts';

/** True for a 429 or a quota / credit error, also when it is wrapped in `cause` or `error`. */
export function isCreditError(err: unknown): boolean {
  return err instanceof InferenceCreditExhausted || isProviderCreditError(err);
}

export class InferenceCreditExhausted extends Error {
  readonly source: string;
  constructor(source: string, cause?: unknown) {
    super(`LiveKit Inference credit exhausted (${detail(cause)}, ${source}): eval aborted, results are not a score`, { cause });
    this.name = 'InferenceCreditExhausted';
    this.source = source;
  }
}

/** Throws InferenceCreditExhausted when `err` is a credit or quota error; otherwise does nothing. */
export function rethrowIfCredit(err: unknown, source: string): void {
  if (err instanceof InferenceCreditExhausted) throw err;
  if (isCreditError(err)) throw new InferenceCreditExhausted(source, err);
}

type ErrorSource = Pick<llm.LLM, 'on'>;

/** Records the first credit error any watched LLM emits; `check()` throws once one was seen. */
export class CreditGuard {
  private tripped: InferenceCreditExhausted | null = null;

  watch(model: ErrorSource, source: string): this {
    model.on('error', (ev: { error?: unknown }) => {
      if (!this.tripped && isCreditError(ev.error)) this.tripped = new InferenceCreditExhausted(source, ev.error);
    });
    return this;
  }

  get exhausted(): InferenceCreditExhausted | null {
    return this.tripped;
  }

  check(): void {
    if (this.tripped) throw this.tripped;
  }
}

/** Replaces last-run.json with an aborted marker so an old or partial scorecard is never read as a score. */
export function writeAbortedMarker(outFile: string, err: InferenceCreditExhausted, profile: string, date: string): void {
  writeFileSync(outFile, JSON.stringify({ date, profile, aborted: true, pass: false, reason: err.message, scenarios: [] }, null, 2));
}
