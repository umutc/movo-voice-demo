'use client';

import { createContext, useContext } from 'react';

// The root layout reads DEMO_ACADEMY_NAME on the server and provides it here, so client pages
// (including app/error.tsx, which gets no props) name the academy from env, not from a literal.
const AcademyContext = createContext<string>('');

export function AcademyProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <AcademyContext.Provider value={name}>{children}</AcademyContext.Provider>;
}

export function useAcademyName(): string {
  return useContext(AcademyContext);
}

/** "Brooklyn Youth Soccer Academy" -> "BYSA". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
