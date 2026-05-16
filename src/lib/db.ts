import mysql, { type Pool, type RowDataPacket, type OkPacket } from 'mysql2/promise';

export type SqlParam = string | number | boolean | null;

export type QueryResultRow = RowDataPacket;

export type QueryResult<T extends QueryResultRow = QueryResultRow> = {
  rows: T[];
  rowCount: number;
  command: string;
};

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
    globalThis.__dbPool = mysql.createPool({
      uri: getDatabaseUrl(),
      connectionLimit: 10,
    });
  }

  return globalThis.__dbPool;
}

export async function runQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: ReadonlyArray<SqlParam> = [],
): Promise<QueryResult<T>> {
  const pool = getPool();

  const normalizedSql = sql.replace(/\$(\d+)/g, '?');
  const [rowsOrResult] = await pool.query(normalizedSql, [...params]);

  if (Array.isArray(rowsOrResult)) {
    const rows = rowsOrResult as T[];
    return {
      rows,
      rowCount: rows.length,
      command: 'SELECT',
    };
  }

  const result = rowsOrResult as OkPacket;
  return {
    rows: [],
    rowCount: result.affectedRows,
    command: result.warningStatus ? 'WRITE_WITH_WARNINGS' : 'WRITE',
  };
}
