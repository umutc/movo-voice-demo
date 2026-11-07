import { NextResponse, type NextRequest } from 'next/server';
import { CONSOLE_COOKIE, consolePassword, consoleToken, safeEqual } from './lib/console/auth';

// Password gate for the read-only console. No CONSOLE_PASSWORD means no console (404).
export async function middleware(req: NextRequest) {
  const password = consolePassword();
  if (!password) return new NextResponse('Not found', { status: 404 });
  const { pathname, search } = req.nextUrl;
  if (pathname === '/console/login') return NextResponse.next();
  const cookie = req.cookies.get(CONSOLE_COOKIE)?.value ?? '';
  if (cookie && safeEqual(cookie, await consoleToken(password))) return NextResponse.next();
  const login = new URL('/console/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ['/console', '/console/:path*'] };
