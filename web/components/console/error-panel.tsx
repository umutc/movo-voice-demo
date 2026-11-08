'use client';

import Link from 'next/link';

/** Body of the console error pages: a database read or a page failed. The console is read-only, so nothing was changed. */
export function ConsoleErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card flex max-w-[640px] flex-col items-start gap-4 p-6">
      <h1 className="font-display text-[26px] tracking-[-0.01em]" style={{ fontWeight: 700 }}>
        This console page could not load.
      </h1>
      <p className="m-0 text-[14px] text-text-secondary">
        A database read or the page itself failed. The console is read-only, so nothing was changed. Try again in a moment.
      </p>
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
          Parent site
        </Link>
      </div>
    </section>
  );
}
