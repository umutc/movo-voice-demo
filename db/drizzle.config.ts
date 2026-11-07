import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` only needs the schema; dbCredentials are used by drizzle-kit push/studio,
// which this repo does not use. Migrations are applied by db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
