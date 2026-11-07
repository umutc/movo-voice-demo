// Console password gate. The cookie holds HMAC-SHA256(key = CONSOLE_PASSWORD, msg = COOKIE_MSG),
// never the password. Web Crypto works in both the middleware (edge) and server actions (Node).
export const CONSOLE_COOKIE = 'rollcall_console';
const COOKIE_MSG = 'rollcall-console-v1';

export function consolePassword(): string | null {
  const pw = process.env.CONSOLE_PASSWORD?.trim();
  return pw ? pw : null;
}

export async function consoleToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(COOKIE_MSG));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-checked compare that does not stop at the first differing character. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
