import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { consolePassword } from '@/lib/console/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Rollcall console',
  description: 'Read-only academy console for the voice enrollment prototype.',
  robots: { index: false, follow: false },
};

// The middleware already returns 404 without CONSOLE_PASSWORD; this is the second check.
export default function ConsoleRootLayout({ children }: { children: React.ReactNode }) {
  if (!consolePassword()) notFound();
  return children;
}
