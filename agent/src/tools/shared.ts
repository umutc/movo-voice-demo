// Helpers shared by the tools: spoken-friendly formatting and the standard error string.
import type { Program, TrialSlot } from 'db/port';

const NY = 'America/New_York';

export const SORRY = 'Sorry,';

export function spokenDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}

export function spokenTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const period = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase() === 'pm' ? 'in the afternoon' : 'in the morning';
  const evening = Number(hour) >= 5 && period === 'in the afternoon' && Number(hour) !== 12 ? 'in the evening' : period;
  return minute === '00' ? `${hour} ${evening}` : `${hour} ${minute} ${evening}`;
}

export function spokenPrice(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `${dollars} dollars a month`;
}

export function describeProgram(p: Program): string {
  return `${p.name}, for ages ${p.ageMin} to ${p.ageMax}, ${p.days} at ${p.location}, ${spokenPrice(p.monthlyPriceCents)}`;
}

export function describeSlot(s: TrialSlot): string {
  return `${spokenDate(s.startsAt)} at ${spokenTime(s.startsAt)} with ${s.coach}`;
}
