// Renders telephony/*.template.json into telephony/out/ (gitignored) by replacing ${ENV_VAR}
// placeholders from the environment. Run with `pnpm telephony:render` (loads .env). Fails on a
// missing variable so a half-rendered file never reaches an `lk` command.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'telephony');
const outDir = join(srcDir, 'out');

export function render(template: string, env: NodeJS.ProcessEnv): string {
  const missing: string[] = [];
  const out = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => {
    const v = env[name]?.trim();
    if (!v) {
      missing.push(name);
      return '';
    }
    return v;
  });
  if (missing.length > 0) throw new Error(`missing env for template: ${[...new Set(missing)].join(', ')}`);
  return out;
}

function main(): void {
  const only = process.argv[2];
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.template.json'));
  let failed = 0;
  for (const f of files) {
    const target = f.replace('.template.json', '.json');
    if (only && !target.startsWith(only)) continue;
    try {
      const rendered = render(readFileSync(join(srcDir, f), 'utf8'), process.env);
      writeFileSync(join(outDir, target), rendered);
      console.log(`rendered telephony/out/${target}`);
    } catch (err) {
      // Optional templates (outbound trunk) stay unrendered until their feature is configured.
      console.log(`skipped ${target}: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }
  if (only && failed > 0) process.exit(1);
}

if (process.env.VITEST === undefined) main();
