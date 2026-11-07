import { NextResponse } from 'next/server';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, type VideoGrant } from 'livekit-server-sdk';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

// Browser token endpoint (PRD section 3.3). The client posts a TokenSourceRequest; only the four
// whitelisted form attributes are copied onto the token, after validation. The grant gives no
// attribute or metadata update permission, so the client cannot change them after joining.
// Trust level stays `self_reported` on the agent side.

export const ATTR = {
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

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development' && process.env.ALLOW_TOKEN_ROUTE !== 'true') {
    return new NextResponse('token route is enabled in development only (set ALLOW_TOKEN_ROUTE=true to override)', { status: 403 });
  }
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

  const suffix = Math.random().toString(36).slice(2, 8);
  const roomName = `web-${suffix}`;
  const identity = `parent-${suffix}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, name: form[ATTR.guardianName], ttl: '15m', attributes });
  const grant: VideoGrant = { room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true };
  at.addGrant(grant);
  at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName })] });

  return NextResponse.json(
    { server_url: url, participant_token: await at.toJwt(), room_name: roomName, participant_name: form[ATTR.guardianName] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
