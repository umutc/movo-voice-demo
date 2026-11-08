import { getHomeCatalog, type HomeCatalog } from 'db/read';
import { App } from '@/components/app/app';
import { demoPaused } from '@/lib/pause';
import { personaName } from '@/lib/site';

// Read env at request time (Cloudflare secrets), not at build time.
export const dynamic = 'force-dynamic';

// Programs and coaches for the sections behind the header nav. A failed read leaves them out;
// the form must still render.
async function loadCatalog(): Promise<HomeCatalog | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('home catalog: DATABASE_URL is not configured');
    return null;
  }
  try {
    return await getHomeCatalog(url);
  } catch (err) {
    console.error('home catalog: read failed', err instanceof Error ? err.message : err);
    return null;
  }
}

// An invalid DEMO_PAUSED keeps the demo paused: closed is the safe side for spend.
function isPaused(): boolean {
  try {
    return demoPaused();
  } catch (err) {
    console.error('home page:', err instanceof Error ? err.message : err);
    return true;
  }
}

// Server component: reads env once and hands plain values to the client shell. Secrets stay
// server-side; the token endpoint mints tokens.
export default async function Page() {
  const catalog = await loadCatalog();
  return (
    <App
      agentName={process.env.AGENT_NAME?.trim() || 'enroll-agent'}
      phoneNumber={process.env.NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER?.trim() || null}
      personaName={personaName()}
      catalog={catalog}
      paused={isPaused()}
    />
  );
}
