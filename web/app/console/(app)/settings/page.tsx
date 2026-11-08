import Link from 'next/link';
import { getLatestPipeline } from 'db/read';
import { Label, PageHeader, SectionHead, Status } from '@/components/console/ui';
import { academyName, databaseUrl, personaName, readLastEvalRun } from '@/lib/console/data';
import { clock, shortDate } from '@/lib/console/format';

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-t border-divider px-6 py-3">
      <Label>{label}</Label>
      <span className={mono ? 'mono text-[13px]' : 'text-[14px]'}>{value}</span>
    </div>
  );
}

function Feature({ name, note, on }: { name: string; note: React.ReactNode; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-divider px-6 py-3">
      <div className="flex flex-col">
        <span className="text-[14px] font-medium">{name}</span>
        <span className="caption">{note}</span>
      </div>
      <span className="text-[13px]">
        <Status dot={on ? 'dot dot-on' : 'dot'}>{on ? 'On' : 'Off'}</Status>
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const persona = personaName();
  const phone = process.env.NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER?.trim() || null;
  const run = readLastEvalRun();
  // The models the agent itself recorded (calls.metrics.pipeline), not the web app's env.
  const latest = await getLatestPipeline(databaseUrl());

  return (
    <>
      <PageHeader title="Agent settings" lead={`Persona, models, channels and the rails ${persona} runs with. Read-only. Models come from the agent's latest recorded call; names and the phone number come from the web config.`} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="card flex flex-col pb-2">
          <SectionHead title="Persona" />
          <Field label="Assistant name" value={persona} />
          <Field label="Academy" value={academyName()} />
          <span className="caption border-t border-divider px-6 py-3">Web config (DEMO_AGENT_PERSONA_NAME, DEMO_ACADEMY_NAME). The agent reads its own copy.</span>
        </section>
        <section className="card flex flex-col pb-2">
          <SectionHead title="Models, through LiveKit Inference" />
          {latest ? (
            <>
              {latest.pipeline.stt && <Field label="Speech to text" value={latest.pipeline.stt} mono />}
              {latest.pipeline.llm && <Field label="Language model" value={latest.pipeline.llm} mono />}
              {latest.pipeline.tts && <Field label="Voice" value={latest.pipeline.tts} mono />}
              <span className="caption border-t border-divider px-6 py-3">
                Recorded by the agent on its latest call, {shortDate(latest.startedAt)}, {clock(latest.startedAt)}.
              </span>
            </>
          ) : (
            <span className="caption border-t border-divider px-6 py-3">No call has recorded its models yet.</span>
          )}
        </section>
        <section className="card flex flex-col pb-2">
          <SectionHead title="Channels and features" />
          <Feature name="Browser calls" note="Parent site form, self_reported identity" on />
          <Feature
            name="Inbound phone"
            note={
              phone ? (
                <>
                  <span className="mono">{phone}</span>, from the web config
                </>
              ) : (
                'NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER is not set'
              )
            }
            on={phone !== null}
          />
          <Feature name="Outbound follow-up calls" note="Not built: the dial port is a fake" on={false} />
          <Feature name="SMS confirmations" note="Not built: the SMS port is a fake and no SMS tool exists" on={false} />
        </section>
        <section className="card flex flex-col pb-2">
          <SectionHead title="Rails, always on" />
          <div className="flex flex-col gap-0.5 border-t border-divider px-6 py-3">
            <span className="text-[14px] font-medium">Read-back before every booking</span>
            <span className="caption">A yes counts only right after the read-back. Anything else clears the proposal; booking needs a fresh read-back.</span>
          </div>
          <div className="flex flex-col gap-0.5 border-t border-divider px-6 py-3">
            <span className="text-[14px] font-medium">Quote only the schedule</span>
            <span className="caption">Prices, times and locations come from Programs and slots. Anything else becomes a callback.</span>
          </div>
          <div className="flex flex-col gap-0.5 border-t border-divider px-6 py-3">
            <span className="text-[14px] font-medium">Family isolation</span>
            <span className="caption">Form-entered numbers open demo records only. Caller id is a hint, never a login.</span>
          </div>
          {run && (
            <div className="flex items-center justify-between gap-4 border-t border-divider px-6 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium">Last eval run</span>
                <span className="caption">
                  {run.date}, {run.profile}, {run.pass ? 'gate passed' : 'gate failed'}, invariants {run.scenarios.length - run.totals.invariantsFailed} of {run.scenarios.length}
                </span>
              </div>
              <Link href="/console/quality" className="text-[13px] font-medium text-accent hover:text-accent-strong">
                Quality
              </Link>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
