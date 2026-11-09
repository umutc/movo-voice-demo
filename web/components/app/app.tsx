'use client';

import { useMemo, useState } from 'react';
import type { HomeCatalog } from 'db/read';
import { TokenSource } from 'livekit-client';
import { RoomAudioRenderer, SessionProvider, useSession, useSessionMessages } from '@livekit/components-react';
import { CallView } from './call-view';
import { DoneView } from './done-view';
import { PAUSED_NOTICE } from '@/lib/pause';
import { PreCallForm } from './pre-call-form';
import { ATTR, type FormValues, type StateSnapshot, type TranscriptLine } from './types';

interface AppProps {
  agentName: string;
  phoneNumber: string | null;
  personaName: string;
  catalog: HomeCatalog | null;
  paused: boolean;
  /** The fixed notice for the current pause reason (lib/pause.ts). */
  pausedNotice: string;
}

type View = 'form' | 'call' | 'done';

export function App({ agentName, phoneNumber, personaName, catalog, paused, pausedNotice }: AppProps) {
  const [view, setView] = useState<View>('form');
  const [form, setForm] = useState<FormValues>({ guardianName: '', phone: '', email: '', consent: false });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [final, setFinal] = useState<{ snapshot: StateSnapshot | null; transcript: TranscriptLine[]; seconds: number } | null>(null);

  const tokenSource = useMemo(() => TokenSource.endpoint('/api/token'), []);
  const session = useSession(tokenSource, {
    agentName,
    participantName: form.guardianName,
    participantAttributes: {
      [ATTR.guardianName]: form.guardianName,
      [ATTR.phone]: form.phone,
      [ATTR.email]: form.email,
      [ATTR.consent]: form.consent ? 'true' : 'false',
    },
  });

  const messagesApi = useSessionMessages(session);

  const start = async (values: FormValues) => {
    setForm(values);
    setError(null);
    setNotice(null);
    setStarting(true);
    try {
      // The session reads the latest options on start; give React one tick to commit them.
      await new Promise((r) => setTimeout(r, 0));
      try {
        await session.start();
      } catch (err) {
        // No microphone (denied or absent): join anyway and let the caller type.
        if (err instanceof Error && /NotAllowed|NotFound|Permission|getUserMedia|device/i.test(err.message)) {
          await session.start({ tracks: { microphone: { enabled: false } } });
        } else {
          throw err;
        }
      }
      setView('call');
    } catch (err) {
      // The token route answers 429 { error: 'daily_limit' } once today's demo calls are used up.
      if (err instanceof Error && err.message.includes(' received 429 ')) {
        setNotice("Today's demo limit is reached. Try again tomorrow.");
        return;
      }
      // The token route answers 503 { error: 'paused', notice } while the demo is paused (env or
      // database). The notice is one of the route's fixed sentences.
      if (err instanceof Error && err.message.includes(' received 503 ') && err.message.includes('paused')) {
        setNotice(/"notice":"([^"]{1,200})"/.exec(err.message)?.[1] ?? PAUSED_NOTICE);
        return;
      }
      setError(err instanceof Error ? err.message.replace(/^Error generating token from endpoint [^:]+: received \d+ \/ /, '') : 'Could not start the call');
    } finally {
      setStarting(false);
    }
  };

  return (
    <SessionProvider session={session}>
      {view === 'form' && <PreCallForm paused={paused} pausedNotice={pausedNotice} phoneNumber={phoneNumber} personaName={personaName} catalog={catalog} onStart={start} error={error} notice={notice} starting={starting} />}
      {view === 'call' && (
        <CallView
          personaName={personaName}
          guardianName={form.guardianName || 'You'}
          messagesApi={messagesApi}
          onEnded={(f) => {
            setFinal(f);
            setView('done');
          }}
        />
      )}
      {view === 'done' && final && (
        <DoneView
          personaName={personaName}
          guardianName={form.guardianName || 'You'}
          snapshot={final.snapshot}
          transcript={final.transcript}
          seconds={final.seconds}
          onRestart={() => {
            setFinal(null);
            setView('form');
          }}
        />
      )}
      <RoomAudioRenderer />
    </SessionProvider>
  );
}
