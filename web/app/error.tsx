'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/app/site-header';

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader full />
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start gap-5 px-10 py-16">
        <h1 className="font-display m-0 text-[40px] leading-[1.05] font-bold tracking-[-0.02em]">This page could not load.</h1>
        <p className="m-0 max-w-[50ch] text-lg leading-[1.55] text-text-secondary">Something failed on our side. Try again, or go back to the home page.</p>
        {error.digest && (
          <span className="caption">
            Error id <span className="mono text-text">{error.digest}</span>
          </span>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Go to the home page
          </Link>
        </div>
      </main>
      <footer className="border-t border-border px-10 py-4 text-xs text-text-muted">Fictional academy, programs, coaches and families.</footer>
    </div>
  );
}
