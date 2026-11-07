// Shared demo-usage cases, run against the fake (pnpm test) and the real adapter (pnpm test:db).
import { expect } from 'vitest';
import type { Harness } from './booking-semantics.ts';

export async function perIpLimitRefusesThirdCall(h: Harness): Promise<void> {
  const req = { channel: 'web' as const, now: h.now, ipHash: 'ip-a', ipLimit: 2, globalLimit: 10 };
  expect((await h.port.reserveDemoUsage(req)).ok).toBe(true);
  expect((await h.port.reserveDemoUsage(req)).ok).toBe(true);
  expect(await h.port.reserveDemoUsage(req)).toEqual({ ok: false, reason: 'ip_limit' });
  // Another IP is still admitted.
  expect((await h.port.reserveDemoUsage({ ...req, ipHash: 'ip-b' })).ok).toBe(true);
  expect(await h.port.countDemoUsage({ now: h.now, ipHash: 'ip-a' })).toBe(2);
  expect(await h.port.countDemoUsage({ now: h.now })).toBe(3);
}

export async function globalLimitCountsWebAndPhone(h: Harness): Promise<void> {
  expect((await h.port.reserveDemoUsage({ channel: 'web', now: h.now, ipHash: 'ip-a', ipLimit: 5, globalLimit: 2 })).ok).toBe(true);
  expect((await h.port.reserveDemoUsage({ channel: 'phone', now: h.now, globalLimit: 2 })).ok).toBe(true);
  expect(await h.port.reserveDemoUsage({ channel: 'phone', now: h.now, globalLimit: 2 })).toEqual({ ok: false, reason: 'global_limit' });
  expect(await h.port.reserveDemoUsage({ channel: 'web', now: h.now, ipHash: 'ip-new', ipLimit: 5, globalLimit: 2 })).toEqual({
    ok: false,
    reason: 'global_limit',
  });
  expect(await h.port.countDemoUsage({ now: h.now })).toBe(2);
}

export async function zeroOrMissingLimitIsOff(h: Harness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    expect((await h.port.reserveDemoUsage({ channel: 'web', now: h.now, ipHash: 'ip-a', ipLimit: 0, globalLimit: 0 })).ok).toBe(true);
  }
  expect((await h.port.reserveDemoUsage({ channel: 'phone', now: h.now })).ok).toBe(true);
  expect(await h.port.countDemoUsage({ now: h.now })).toBe(4);
}

export async function yesterdayDoesNotCount(h: Harness): Promise<void> {
  const yesterday = new Date(h.now.getTime() - 86_400_000);
  for (let i = 0; i < 2; i++) await h.port.reserveDemoUsage({ channel: 'web', now: yesterday, ipHash: 'ip-a', ipLimit: 2, globalLimit: 2 });
  expect((await h.port.reserveDemoUsage({ channel: 'web', now: h.now, ipHash: 'ip-a', ipLimit: 2, globalLimit: 2 })).ok).toBe(true);
}

export async function concurrentReservationsStopAtLimit(h: Harness): Promise<void> {
  const results = await Promise.all(Array.from({ length: 6 }, () => h.port.reserveDemoUsage({ channel: 'phone', now: h.now, globalLimit: 3 })));
  expect(results.filter((r) => r.ok)).toHaveLength(3);
  expect(await h.port.countDemoUsage({ now: h.now })).toBe(3);
}
