import { App } from '@/components/app/app';

// Read env at request time (Cloudflare secrets), not at build time.
export const dynamic = 'force-dynamic';

// Server component: reads env once and hands plain values to the client shell. Secrets stay
// server-side; the token endpoint mints tokens.
export default function Page() {
  return (
    <App
      agentName={process.env.AGENT_NAME?.trim() || 'enroll-agent'}
      phoneNumber={process.env.NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER?.trim() || null}
      academyName={process.env.DEMO_ACADEMY_NAME?.trim() || 'Brooklyn Youth Soccer Academy'}
      personaName={process.env.DEMO_AGENT_PERSONA_NAME?.trim() || 'Maya'}
      pipeline={{
        stt: process.env.LK_STT_MODEL?.trim() || 'deepgram/nova-3',
        llm: process.env.LK_LLM_MODEL?.trim() || 'openai/gpt-6.1-terra',
        tts: process.env.LK_TTS_MODEL?.trim() || 'deepgram/aura-2:athena',
      }}
    />
  );
}
