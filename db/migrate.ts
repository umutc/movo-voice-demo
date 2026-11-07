// Applies db/migrations to the target database.
//   pnpm db:migrate            -> DIRECT_DATABASE_URL (schema public)
//   pnpm db:migrate -- --test  -> TEST_DATABASE_URL (schema test, migrations table inside `test`)
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.ts';

export async function runMigrations(url: string, migrationsSchema: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), 'migrations'), migrationsSchema });
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  const isTest = process.argv.includes('--test');
  const url = isTest ? process.env.TEST_DATABASE_URL : (process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL);
  if (!url) throw new Error(isTest ? 'TEST_DATABASE_URL is not set' : 'DIRECT_DATABASE_URL is not set');
  await runMigrations(url, isTest ? 'test' : 'drizzle');
  console.log(`migrations applied to ${isTest ? 'test schema' : 'public schema'}`);
}

if (process.env.VITEST === undefined) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
