import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CONSOLE_COOKIE, consolePassword, consoleToken, safeEqual } from '@/lib/console/auth';
import { academyName } from '@/lib/console/data';

function safeNext(v: FormDataEntryValue | string | null | undefined): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/console') && !s.startsWith('/console/login') && !s.includes('//') ? s : '/console';
}

async function login(formData: FormData) {
  'use server';
  const password = consolePassword();
  if (!password) redirect('/');
  const next = safeNext(formData.get('next'));
  const given = String(formData.get('password') ?? '');
  const ok = safeEqual(await consoleToken(given), await consoleToken(password));
  if (!ok) redirect(`/console/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set(CONSOLE_COOKIE, await consoleToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/console',
    maxAge: 12 * 60 * 60,
  });
  redirect(next);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <form action={login} className="card flex w-full max-w-[380px] flex-col gap-5 p-7">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-[3px] bg-accent" />
          <span className="font-display text-[19px] tracking-[-0.02em]" style={{ fontWeight: 700 }}>
            rollcall
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-[22px]" style={{ fontWeight: 700 }}>
            Console sign in
          </h1>
          <span className="text-[13px] text-text-muted">{academyName()}. Enter the console password to open the read-only console.</span>
        </div>
        <input type="hidden" name="next" value={safeNext(sp.next)} />
        <label className="flex flex-col gap-1.5">
          <span className="label">Password</span>
          <input className="input" type="password" name="password" autoComplete="current-password" required autoFocus />
        </label>
        {sp.error && (
          <span role="alert" className="flex items-center gap-2 text-[13px] text-warning">
            <span className="dot dot-warning" />
            That password did not match. Try again.
          </span>
        )}
        <button type="submit" className="btn-primary">
          Open the console
        </button>
        <p className="caption">Fictional academy and families. Prototype on LiveKit Agents.</p>
      </form>
    </main>
  );
}
