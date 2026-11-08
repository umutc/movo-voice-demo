'use client';

import { ConsoleErrorPanel } from '@/components/console/error-panel';

// Errors from a console page render inside the console nav.
export default function ConsolePageError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ConsoleErrorPanel {...props} />;
}
