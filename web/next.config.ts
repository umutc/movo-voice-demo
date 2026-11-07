import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// One .env for the whole repo: load it into the Next.js server process when present. Values
// already in the environment win. Nothing from it is exposed to the browser unless prefixed
// with NEXT_PUBLIC_.
const rootEnv = resolve(process.cwd(), '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The Amplify build copies only a fixed list of variables into .env.production (amplify.yml), so
// the console password and feature flags are inlined at build time instead. Only server code and
// the middleware read them; no client component references these names.
const buildTimeEnv: Record<string, string> = {};
for (const name of ['CONSOLE_PASSWORD', 'FEATURE_SMS', 'FEATURE_OUTBOUND']) {
  const v = process.env[name];
  if (v !== undefined) buildTimeEnv[name] = v;
}

const nextConfig: NextConfig = {
  env: buildTimeEnv,
  transpilePackages: ['db'],
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
