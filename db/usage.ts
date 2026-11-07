// Pure rules for the demo usage caps, shared by the real adapter and the fake.
import type { DemoUsageRequest, DemoUsageResult } from './port.ts';

/** Start of the UTC day that contains `now`. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A limit is on only when it is a positive number; null, undefined and 0 mean no limit. */
export function limitOn(limit: number | null | undefined): limit is number {
  return typeof limit === 'number' && limit > 0;
}

/** Decides admission from today's counts. Global cap first: it is the real guard. */
export function decideDemoUsage(
  input: DemoUsageRequest,
  counts: { global: number; ip: number },
): Extract<DemoUsageResult, { ok: false }> | null {
  if (limitOn(input.globalLimit) && counts.global >= input.globalLimit) return { ok: false, reason: 'global_limit' };
  if (input.ipHash && limitOn(input.ipLimit) && counts.ip >= input.ipLimit) return { ok: false, reason: 'ip_limit' };
  return null;
}

/**
 * Client IP from the `x-forwarded-for` header: the first entry. Behind CloudFront this is the
 * address the edge saw, but a client can prepend its own value, so treat it as a hint only.
 */
export function clientIpFromForwardedFor(header: string | null | undefined): string | null {
  const first = header?.split(',')[0]?.trim();
  return first ? first : null;
}
