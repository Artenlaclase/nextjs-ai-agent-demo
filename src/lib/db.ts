import { Pool, type QueryResultRow } from 'pg';

export type SqlParam = string | number | boolean | null;

declare global {
  // Reuse one pool in dev to avoid exhausting DB connections during hot reloads.
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined;
}

function getDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL no esta configurada.');
  }

  return connectionString;
}

export function getPool(): Pool {
  if (!globalThis.__dbPool) {
    globalThis.__dbPool = new Pool({
      connectionString: getDatabaseUrl(),
    });
  }

  return globalThis.__dbPool;
}

export async function runQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: ReadonlyArray<SqlParam> = [],
) {
  const pool = getPool();
  return pool.query<T>(sql, [...params]);
}
