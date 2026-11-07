import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * App connection. Supabase transaction pooler needs `prepare: false` (no named prepared statements
 * across pooled connections). The session pooler and a direct connection accept it too.
 */
export function createDb(url: string, opts: { max?: number; prepare?: boolean } = {}) {
  const client = postgres(url, {
    max: opts.max ?? 4,
    prepare: opts.prepare ?? false,
    ssl: 'require',
    connect_timeout: 15,
    idle_timeout: 30,
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}
