import Link from 'next/link';
import { SiteHeader } from '@/components/app/site-header';

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader full />
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start gap-5 px-10 py-16">
        <h1 className="font-display m-0 text-[40px] leading-[1.05] font-bold tracking-[-0.02em]">This page does not exist.</h1>
        <p className="m-0 max-w-[50ch] text-lg leading-[1.55] text-text-secondary">The link may be old or mistyped. The free trial form is on the home page.</p>
        <Link href="/" className="btn-primary">
          Go to the home page
        </Link>
      </main>
      <footer className="border-t border-border px-10 py-4 text-xs text-text-muted">Fictional academy, programs, coaches and families.</footer>
    </div>
  );
}
