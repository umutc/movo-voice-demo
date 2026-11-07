import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// One .env for the whole repo: load it into the Next.js server process when present. Values
// already in the environment win. Nothing from it is exposed to the browser unless prefixed
// with NEXT_PUBLIC_.
const rootEnv = resolve(process.cwd(), '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ['db'],
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
