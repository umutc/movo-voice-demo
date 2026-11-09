// Classifies model provider errors (LiveKit Inference STT, LLM, TTS). Shared by the agent's
// automatic pause and the eval's credit guard (eval/credit.ts re-exports isCreditError).
// LiveKit Inference reports a used-up credit as 429 MaxGatewayCredits; the SDK retries a 429 and
// then throws a generic "failed after N attempts" error, so callers listen to each model's
// "error" event, which carries the original status error.

const QUOTA_TEXT = /MaxGatewayCredits|insufficient[_ ]?(credit|quota)|quota|credit(s)? (exhausted|exceeded)|rate.?limit|\b429\b/i;
// Credit or quota wording only: no bare 429 or rate limit (those can be transient).
const CREDIT_TEXT = /MaxGatewayCredits|insufficient[_ ]?(credit|quota)|quota|credit(s)? (exhausted|exceeded)/i;
const AUTH_TEXT = /unauthori[sz]ed|invalid[_ ]?api[_ ]?key|invalid[_ ]?token|forbidden|permission denied/i;

function textOf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type ErrShape = { statusCode?: unknown; status?: unknown; message?: unknown; body?: unknown; cause?: unknown; error?: unknown };

/** Walks `err`, its `cause` and `error` (depth 4) and returns true when `test` matches one. */
function anyLayer(err: unknown, test: (e: ErrShape | string) => boolean, depth = 0): boolean {
  if (typeof err === 'string') return test(err);
  if (!err || typeof err !== 'object' || depth > 4) return false;
  const e = err as ErrShape;
  if (test(e)) return true;
  return anyLayer(e.cause, test, depth + 1) || anyLayer(e.error, test, depth + 1);
}

const textOfErr = (e: ErrShape | string): string => (typeof e === 'string' ? e : `${textOf(e.message)} ${textOf(e.body)}`);
const statusOf = (e: ErrShape | string): unknown => (typeof e === 'string' ? undefined : (e.statusCode ?? e.status));

/** True for a 429 or a quota / credit error, also when it is wrapped in `cause` or `error`. */
export function isCreditError(err: unknown): boolean {
  return anyLayer(err, (e) => statusOf(e) === 429 || QUOTA_TEXT.test(textOfErr(e)));
}

/** True for a 401 or 403, or auth wording (unauthorized, invalid API key). */
export function isAuthError(err: unknown): boolean {
  return anyLayer(err, (e) => statusOf(e) === 401 || statusOf(e) === 403 || AUTH_TEXT.test(textOfErr(e)));
}

/** A short fixed label for logs and alerts; never the provider's raw message. */
export function creditDetail(err: unknown): string {
  if (anyLayer(err, (e) => /MaxGatewayCredits/i.test(textOfErr(e)))) return '429 MaxGatewayCredits';
  if (anyLayer(err, (e) => statusOf(e) === 429)) return '429';
  if (anyLayer(err, (e) => statusOf(e) === 401)) return '401 unauthorized';
  if (anyLayer(err, (e) => statusOf(e) === 403)) return '403 forbidden';
  if (isAuthError(err)) return 'auth error';
  return 'quota error';
}

export type ProviderErrorClass = { kind: 'credit' | 'auth'; detail: string };

/**
 * Decides whether a model error should pause the demo. Credit or quota wording and auth errors
 * pause at once. A bare 429 or rate limit pauses only when the SDK gave up (`recoverable` false),
 * so a short rate limit that a retry fixes does not close the demo.
 */
export function classifyProviderError(err: unknown, recoverable = false): ProviderErrorClass | null {
  if (isAuthError(err)) return { kind: 'auth', detail: creditDetail(err) };
  if (anyLayer(err, (e) => CREDIT_TEXT.test(textOfErr(e)))) return { kind: 'credit', detail: creditDetail(err) };
  if (!recoverable && isCreditError(err)) return { kind: 'credit', detail: creditDetail(err) };
  return null;
}
