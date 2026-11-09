import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { openDb } from 'db';
import { Alerter, alertPortFromEnv, parseAlertsEnv } from 'db/alerts';
import { DrizzleOps } from 'db/ops';
import { clientIpFromForwardedFor, limitOn } from 'db/usage';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, type VideoGrant } from 'livekit-server-sdk';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { demoPaused, pausedNotice } from '../../../lib/pause.ts';

// Browser token endpoint (PRD section 3.3). The client posts a TokenSourceRequest; only the four
// whitelisted form attributes are copied onto the token, after validation. The grant gives no
// attribute or metadata update permission, so the client cannot change them after joining.
// Trust level stays `self_reported` on the agent side.

const ATTR = {
  guardianName: 'movo.guardian_name',
  phone: 'movo.phone',
  email: 'movo.email',
  consent: 'movo.consent',
} as const;

const formSchema = z.object({
  [ATTR.guardianName]: z.string().trim().min(2, 'Enter your name').max(80),
  [ATTR.phone]: z.string().trim().max(32).optional().default(''),
  [ATTR.email]: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional().default(''),
  [ATTR.consent]: z.literal('true', { message: 'Consent is required to start a call' }),
});

const requestSchema = z.object({
  participant_attributes: formSchema,
});

export const revalidate = 0;

// Abuse limiting, not authentication: a browser on another site cannot mint tokens, and each token
// is short-lived and bound to a two-participant room (one caller plus the agent). Allowed origins
// come from ALLOWED_ORIGINS (comma-separated); localhost is added outside production.
function allowedOrigins(): Set<string> {
  const configured = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const dev = process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : [];
  return new Set([...configured, ...dev]);
}

// Daily demo caps (spend guard). Unset or 0 means no limit, so local development needs nothing.
const limitValue = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.coerce.number().int().min(0).optional());
const limitsSchema = z.object({
  DEMO_LIMIT_PER_IP_PER_DAY: limitValue,
  DEMO_LIMIT_GLOBAL_PER_DAY: limitValue,
});

/** HMAC-SHA256 of the client IP keyed with the LiveKit secret; the raw IP is never stored. */
function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

const noStore = { 'Cache-Control': 'no-store' };

function pausedResponse(notice: string): NextResponse {
  return NextResponse.json({ error: 'paused', notice }, { status: 503, headers: noStore });
}

/** One Alerter per request; the dedupe uses the request's connection, the throttle is per process. */
function alerterFor(ops: DrizzleOps | null): Alerter {
  const cfg = parseAlertsEnv(process.env);
  return new Alerter({ port: alertPortFromEnv(cfg), log: ops, cooldownMs: cfg.cooldownMs });
}

/**
 * Database checks for one browser call, on one connection: the demo_state pause row, then today's
 * caps (which also record the call). Returns a response when the request must stop. Without
 * DATABASE_URL and without caps (local development) nothing is checked. Every failure fails
 * closed with 503 and one fail_closed alert (deduped); a full global cap sends daily_limit.
 */
async function admitWebCall(req: Request, secret: string): Promise<NextResponse | null> {
  const parsed = limitsSchema.safeParse(process.env);
  if (!parsed.success) return new NextResponse('demo limit environment is invalid', { status: 500 });
  const { DEMO_LIMIT_PER_IP_PER_DAY: ipLimit, DEMO_LIMIT_GLOBAL_PER_DAY: globalLimit } = parsed.data;
  const limitsOn = limitOn(ipLimit) || limitOn(globalLimit);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return limitsOn ? new NextResponse('database is not configured', { status: 500 }) : null;
  const { port, db, close } = openDb(dbUrl);
  const ops = new DrizzleOps(db);
  try {
    let state;
    try {
      state = await ops.getDemoState();
    } catch {
      await alerterFor(ops).send('fail_closed', { detail: 'web pause check' });
      return new NextResponse('pause check failed', { status: 503 });
    }
    if (state.paused) return pausedResponse(pausedNotice({ env: false, reason: state.reason }));
    if (!limitsOn) return null;
    const ip = clientIpFromForwardedFor(req.headers.get('x-forwarded-for'));
    let result;
    try {
      result = await port.reserveDemoUsage({
        channel: 'web',
        now: new Date(),
        ipHash: ip ? hashIp(ip, secret) : null,
        ipLimit: ipLimit ?? null,
        globalLimit: globalLimit ?? null,
      });
    } catch {
      // Fail closed: without a working count the cap cannot hold.
      await alerterFor(ops).send('fail_closed', { detail: 'web usage count' });
      return new NextResponse('usage check failed', { status: 503 });
    }
    if (!result.ok) {
      if (result.reason === 'global_limit') await alerterFor(ops).send('daily_limit', { detail: 'web token route' });
      return NextResponse.json({ error: 'daily_limit' }, { status: 429, headers: noStore });
    }
    return null;
  } finally {
    await close().catch(() => {});
  }
}

function requestOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  if (origin) return origin;
  const referer = req.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development' && process.env.ALLOW_TOKEN_ROUTE !== 'true') {
    return new NextResponse('token route is enabled in development only (set ALLOW_TOKEN_ROUTE=true to override)', { status: 403 });
  }
  const origin = requestOrigin(req);
  if (!origin || !allowedOrigins().has(origin)) return new NextResponse('origin not allowed', { status: 403 });
  // DEMO_PAUSED: stop before minting a token or writing demo_usage, so a direct call cannot start a session.
  // The demo_state row is checked in admitWebCall, before the caps.
  let paused: boolean;
  try {
    paused = demoPaused();
  } catch {
    return new NextResponse('DEMO_PAUSED is invalid', { status: 500 });
  }
  if (paused) return pausedResponse(pausedNotice({ env: true }));
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const agentName = process.env.AGENT_NAME?.trim() || 'enroll-agent';
  if (!url || !apiKey || !apiSecret) return new NextResponse('LiveKit environment is not configured', { status: 500 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse('invalid JSON', { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return new NextResponse(first ? first.message : 'invalid form', { status: 400 });
  }
  const form = parsed.data.participant_attributes;
  const phone = form[ATTR.phone] ? parsePhoneNumberFromString(form[ATTR.phone], 'US') : null;
  if (form[ATTR.phone] && !phone?.isPossible()) return new NextResponse('Enter a valid mobile number', { status: 400 });

  const attributes: Record<string, string> = {
    [ATTR.guardianName]: form[ATTR.guardianName],
    [ATTR.consent]: 'true',
  };
  if (phone) attributes[ATTR.phone] = phone.number;
  if (form[ATTR.email]) attributes[ATTR.email] = form[ATTR.email];

  const refused = await admitWebCall(req, apiSecret);
  if (refused) return refused;

  const suffix = Math.random().toString(36).slice(2, 8);
  const roomName = `web-${suffix}`;
  const identity = `parent-${suffix}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, name: form[ATTR.guardianName], ttl: '5m', attributes });
  const grant: VideoGrant = { room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true };
  at.addGrant(grant);
  at.roomConfig = new RoomConfiguration({ maxParticipants: 2, emptyTimeout: 120, agents: [new RoomAgentDispatch({ agentName })] });

  return NextResponse.json(
    { server_url: url, participant_token: await at.toJwt(), room_name: roomName, participant_name: form[ATTR.guardianName] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
