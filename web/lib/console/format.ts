// Display helpers for the console. The academy is in Brooklyn, so days and clocks use New York time.
export const NY = 'America/New_York';

/** `+1 718 ••• 0142`. Never shows the middle digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (phone.startsWith('+1') && digits.length === 11) return `+1 ${digits.slice(1, 4)} ••• ${digits.slice(-4)}`;
  if (digits.length < 6) return '•••';
  return `+${digits.slice(0, 2)} ••• ${digits.slice(-4)}`;
}

/** YYYY-MM-DD of the instant in New York. */
export function dayKey(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: NY, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' }).format(new Date(iso));
}

export function weekdayDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
}

export function longToday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
}

/** `9:30 am`, `6:00 pm`. */
export function slotTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).toLowerCase();
}

/** `Today 10:42` or `Nov 5, 16:10`. */
export function when(iso: string, now: Date): string {
  return dayKey(iso) === dayKey(now) ? `Today ${clock(iso)}` : `${shortDate(iso)}, ${clock(iso)}`;
}

/** m:ss between two instants, or null while the call has no end time. */
export function callLength(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const s = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ms(v: number | null): string {
  return v === null ? 'n/a' : `${v.toLocaleString('en-US')} ms`;
}

export function channel(direction: string): string {
  return direction === 'browser' ? 'Browser' : direction === 'outbound' ? 'Outbound' : 'Phone';
}

export function outcomeLabel(outcome: string | null): string {
  if (!outcome) return 'No outcome';
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export function outcomeDot(outcome: string | null): string {
  return outcome === 'booked' ? 'dot dot-on' : outcome === 'callback' ? 'dot dot-warning' : 'dot';
}

export function childrenText(kids: { name: string; age: number }[]): string | null {
  if (kids.length === 0) return null;
  const parts = kids.map((k) => `${k.name}, ${k.age}`);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
