import fs from 'node:fs';
import path from 'node:path';
import { createPool } from 'mysql2/promise';

const projectRoot = process.cwd();

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvFile(fileName) {
  const filePath = path.join(projectRoot, fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(rawLine);
    if (!parsed) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

function shouldSkipCheck() {
  const value = process.env.SKIP_DB_CHECK?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

if (shouldSkipCheck()) {
  console.log('[db-check] Omitido por SKIP_DB_CHECK=true.');
  process.exit(0);
}

// Follow Next.js env precedence: .env first, then .env.local overrides.
loadEnvFile('.env');
loadEnvFile('.env.local');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('[db-check] DATABASE_URL no esta configurada en .env o .env.local.');
  process.exit(1);
}

if (!databaseUrl.startsWith('mysql://')) {
  console.error('[db-check] DATABASE_URL debe usar esquema mysql:// para este proyecto.');
  process.exit(1);
}

try {
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: 1,
  });

  await pool.query('SELECT 1 AS ok');
  await pool.end();

  console.log('[db-check] Conexion MySQL OK.');
} catch (error) {
  const maybeError = error && typeof error === 'object' ? error : {};
  const baseMessage = error instanceof Error ? error.message : String(error);
  const details = [
    'code' in maybeError && maybeError.code ? `code=${maybeError.code}` : null,
    'address' in maybeError && maybeError.address ? `host=${maybeError.address}` : null,
    'port' in maybeError && maybeError.port ? `port=${maybeError.port}` : null,
    'sqlMessage' in maybeError && maybeError.sqlMessage ? `sqlMessage=${maybeError.sqlMessage}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const suffix = details ? ` (${details})` : '';
  console.error(`[db-check] No se pudo conectar a MySQL: ${baseMessage}${suffix}`);
  process.exit(1);
}