'use client';

import { ConsoleErrorPanel } from '@/components/console/error-panel';

// Catches errors from app/console/(app)/layout.tsx itself (its callback count reads the database),
// which the (app) error page cannot catch. Renders without the nav, which failed to load.
export default function ConsoleLayoutError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-svh flex-col gap-6 px-10 pt-7 pb-8">
      <ConsoleErrorPanel {...props} />
      <p className="caption mt-auto">Fictional academy and families. Prototype on LiveKit Agents.</p>
    </main>
  );
}
