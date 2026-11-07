'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/console', label: 'Dashboard' },
  { href: '/console/calls', label: 'Calls' },
  { href: '/console/callbacks', label: 'Callbacks' },
  { href: '/console/families', label: 'Families' },
  { href: '/console/programs', label: 'Programs and slots' },
  { href: '/console/quality', label: 'Quality' },
  { href: '/console/settings', label: 'Agent settings' },
];

export function ConsoleNav({ academyName, callbacks }: { academyName: string; callbacks: number }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/console' ? pathname === '/console' : pathname.startsWith(href));
  return (
    <nav aria-label="Rollcall" className="sticky top-0 flex h-svh w-[240px] shrink-0 flex-col overflow-y-auto gap-0.5 border-r border-border bg-surface px-4 pt-5 pb-6">
      <Link href="/console" className="flex items-center gap-2 px-2 py-1 text-text">
        <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-[3px] bg-accent" />
        <span className="font-display text-[19px] tracking-[-0.02em]" style={{ fontWeight: 700 }}>
          rollcall
        </span>
      </Link>
      {/* One seeded academy: the switcher renders it and has nothing to switch to. */}
      <div
        aria-label="Academy"
        className="mt-3 mb-4 flex h-11 items-center justify-between gap-2 rounded-[8px] border border-border bg-surface-muted px-3 text-[13px] font-medium"
      >
        <span className="truncate">{academyName}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </div>
      {LINKS.map((l) => {
        const active = isActive(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[38px] items-center rounded-[8px] px-2.5 text-[14px] ${active ? 'bg-background font-semibold text-text' : 'font-medium text-text-secondary hover:bg-surface-muted'}`}
          >
            {l.label}
            {l.href === '/console/callbacks' && callbacks > 0 && <span className="ml-auto text-[12px] font-semibold text-warning">{callbacks}</span>}
          </Link>
        );
      })}
      <div className="flex-1" />
      <Link href="/" className="flex h-[38px] items-center rounded-[8px] px-2.5 text-[13px] font-medium text-text-secondary hover:bg-surface-muted">
        Parent site
      </Link>
    </nav>
  );
}
