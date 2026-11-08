'use client';

import { useState } from 'react';
import { formatPhone } from '@/lib/call-format';
import { PAUSED_NOTICE } from '@/lib/pause';
import type { HomeCatalog } from 'db/read';
import { HomeSections } from './home-sections';
import { MicIcon, SiteHeader } from './site-header';
import type { FormValues } from './types';

interface Props {
  paused: boolean;
  phoneNumber: string | null;
  personaName: string;
  catalog: HomeCatalog | null;
  onStart: (values: FormValues) => Promise<void>;
  error: string | null;
  notice: string | null;
  starting: boolean;
}

export function PreCallForm({ paused, phoneNumber, personaName, catalog, onStart, error, notice, starting }: Props) {
  const [values, setValues] = useState<FormValues>({ guardianName: '', phone: '', email: '', consent: false });
  const canStart = values.guardianName.trim().length >= 2 && values.consent && !starting && !paused;

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader full>
        <nav aria-label="Site" className="flex gap-4 text-sm font-medium whitespace-nowrap text-text-secondary sm:gap-6">
          {catalog && catalog.programs.length > 0 && <a href="#programs">Programs</a>}
          {catalog && catalog.coaches.length > 0 && <a href="#coaches">Coaches</a>}
          <a href="#trial" className="text-accent">
            Free trial
          </a>
        </nav>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-wrap items-start gap-10 px-10 py-12">
        <section className="flex min-w-0 flex-[1_1_440px] flex-col gap-6">
          <h1 className="font-display m-0 text-[54px] leading-[1.02] font-bold tracking-[-0.02em]">Book a free trial class by talking to {personaName}.</h1>
          <p className="m-0 max-w-[50ch] text-lg leading-[1.55] text-text-secondary">
            {personaName} answers for the academy. Tell her your child&apos;s age; she finds the right group, offers a slot in the next two
            weeks, reads the details back and books it on the call. Interrupt her whenever you like.
          </p>
          <div className="card flex flex-col gap-2 p-5">
            <span className="caption font-medium tracking-wide uppercase">Example call</span>
            <p className="m-0 text-[15px]">
              <span className="font-semibold">You:</span> My son is nine and we&apos;re near McCarren.
            </p>
            <p className="m-0 text-[15px]">
              <span className="font-semibold text-accent">{personaName}:</span> Nine means Academy U10 at McCarren Park on Tuesday and
              Thursday evenings. Want me to check the open trial classes?
            </p>
          </div>
          <p className="caption m-0 text-[13px]">
            {personaName} is an AI assistant. This is a prototype running on fictional academy data; no real families are contacted.
          </p>
        </section>

        <section id="trial" className="card flex scroll-mt-6 min-w-0 flex-[0_1_440px] flex-col gap-5 p-7">
          <div className="flex flex-col gap-1">
            <h2 className="font-display m-0 text-[22px] font-semibold">Start a call</h2>
            <p className="caption m-0 text-sm">About two minutes. Uses your microphone.</p>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canStart) void onStart(values);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="guardian" className="label">
                Your name
              </label>
              <input
                id="guardian"
                name="guardian"
                type="text"
                autoComplete="name"
                placeholder="Dana Whitfield"
                className="input"
                value={values.guardianName}
                onChange={(e) => setValues({ ...values, guardianName: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="phone" className="label">
                Mobile number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="(718) 555-0142"
                className="input"
                value={values.phone}
                onChange={(e) => setValues({ ...values, phone: e.target.value })}
              />
              <span className="caption">So {personaName} recognizes you if you call back. Not verified in this prototype.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="dana@example.com"
                className="input"
                value={values.email}
                onChange={(e) => setValues({ ...values, email: e.target.value })}
              />
            </div>
            <div className="flex items-start gap-3">
              <input
                id="consent"
                name="consent"
                type="checkbox"
                className="mt-[1px] h-5 w-5 flex-none accent-accent"
                checked={values.consent}
                onChange={(e) => setValues({ ...values, consent: e.target.checked })}
              />
              <label htmlFor="consent" className="text-[13px] leading-[1.5] text-text-secondary">
                I agree to talk with an automated assistant about academy programs. I can end the call at any time.
              </label>
            </div>
            {error && (
              <p className="m-0 flex items-center gap-2 text-[13px] text-danger">
                <span className="dot dot-danger" /> {error}
              </p>
            )}
            {paused && (
              <p role="status" className="m-0 flex items-center gap-2 text-[13px] text-text-secondary">
                <span className="dot dot-warning" /> {PAUSED_NOTICE}
              </p>
            )}
            {notice && !paused && (
              <p role="status" className="m-0 flex items-center gap-2 text-[13px] text-text-secondary">
                <span className="dot dot-warning" /> {notice}
              </p>
            )}
            <button type="submit" className="btn-primary" disabled={!canStart}>
              <MicIcon />
              <span>{starting ? 'Connecting' : 'Start call'}</span>
            </button>
          </form>
          {phoneNumber && !paused && (
            <p className="caption m-0 text-center text-[13px]">
              Or call{' '}
              <a href={`tel:${phoneNumber}`} className="font-semibold whitespace-nowrap text-text no-underline hover:text-accent-strong">
                {formatPhone(phoneNumber)}
              </a>{' '}
              from any phone.
            </p>
          )}
        </section>
      </main>
      {catalog && <HomeSections catalog={catalog} />}
      <footer className="flex flex-wrap justify-between gap-4 border-t border-border px-10 py-4 text-xs text-text-muted">
        <span>Prototype on LiveKit Agents. Not a production system.</span>
        <span>Fictional academy, programs, coaches and families.</span>
      </footer>
    </div>
  );
}
