import { countCallbacks } from 'db/read';
import { ConsoleNav } from '@/components/console/nav';
import { academyName, databaseUrl } from '@/lib/console/data';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const callbacks = await countCallbacks(databaseUrl());
  return (
    <div className="flex min-h-svh items-stretch">
      <ConsoleNav academyName={academyName()} callbacks={callbacks} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-10 pt-7 pb-8">
        {children}
        <p className="caption mt-auto">Fictional academy and families. Prototype on LiveKit Agents.</p>
      </main>
    </div>
  );
}
