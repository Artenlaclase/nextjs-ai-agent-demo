import { openai } from '@ai-sdk/openai';
import { streamText, tool, UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { runQuery, type SqlParam } from '@/lib/db';

export const maxDuration = 30;

const sqlParamsSchema = z
  .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .max(50)
  .optional();

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '');
}

function hasMultipleStatements(sql: string): boolean {
  return sql.includes(';');
}

function assertReadOnlySql(sql: string) {
  const normalized = normalizeSql(sql);
  const lowered = normalized.toLowerCase();

  if (!/^(select|with)\b/.test(lowered)) {
    throw new Error('Solo se permiten consultas de lectura (SELECT/CTE).');
  }

  if (hasMultipleStatements(normalized)) {
    throw new Error('No se permiten multiples sentencias SQL.');
  }

  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(lowered)) {
    throw new Error('La consulta contiene palabras reservadas de escritura/admin no permitidas.');
  }

  return normalized;
}

function assertMutationSql(sql: string) {
  if (process.env.SQL_ADMIN_ENABLED !== 'true') {
    throw new Error('Las mutaciones SQL estan deshabilitadas. Activa SQL_ADMIN_ENABLED=true.');
  }

  const normalized = normalizeSql(sql);
  const lowered = normalized.toLowerCase();

  if (!/^(insert|update|delete)\b/.test(lowered)) {
    throw new Error('Solo se permiten sentencias INSERT, UPDATE o DELETE.');
  }

  if (hasMultipleStatements(normalized)) {
    throw new Error('No se permiten multiples sentencias SQL.');
  }

  if (/\b(drop|alter|create|truncate|grant|revoke)\b/i.test(lowered)) {
    throw new Error('Esta sentencia contiene operaciones administrativas no permitidas.');
  }

  return normalized;
}

function applyReadLimit(sql: string, maxRows: number): string {
  const boundedLimit = Math.min(Math.max(maxRows, 1), 200);
  return `SELECT * FROM (${sql}) AS subquery LIMIT ${boundedLimit}`;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: openai('gpt-4.1'),
    messages: modelMessages,
    system: `
Eres un asistente útil y resolutivo.
Tienes acceso a herramientas externas.
Si el usuario pregunta algo que requiere consultar datos o ejecutar una acción,
usa la herramienta adecuada antes de responder.
Si la herramienta devuelve datos simulados, aclara que son de ejemplo.
Si necesitas datos reales de la base de datos usa primero sql_listar_tablas y luego
sql_consultar. Solo usa sql_ejecutar para cambios cuando el usuario lo pida claramente.
    `.trim(),
    tools: {
      obtener_clima: tool({
        description: 'Obtiene el clima actual simulado de una ciudad específica.',
        inputSchema: z.object({
          ciudad: z
            .string()
            .describe('Nombre de la ciudad. Ejemplo: Valparaíso, Santiago, Buenos Aires'),
        }),
        execute: async ({ ciudad }) => {
          return {
            ciudad,
            temperatura: '22°C',
            condicion: 'Parcialmente nublado',
            fuente: 'mock',
          };
        },
      }),
      sql_listar_tablas: tool({
        description: 'Lista las tablas disponibles en el esquema public de PostgreSQL.',
        inputSchema: z.object({}),
        execute: async () => {
          const result = await runQuery<{
            table_name: string;
          }>(
            `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name ASC
            `,
          );

          return {
            total: result.rowCount,
            tables: result.rows.map((row: { table_name: string }) => row.table_name),
          };
        },
      }),
      sql_consultar: tool({
        description:
          'Ejecuta una consulta SQL de solo lectura (SELECT/CTE) sobre PostgreSQL y devuelve filas.',
        inputSchema: z.object({
          sql: z.string().min(1).describe('Consulta SQL de lectura, por ejemplo: SELECT * FROM usuarios'),
          params: sqlParamsSchema.describe('Parametros opcionales para placeholders SQL ($1, $2, etc.).'),
          maxRows: z.number().int().min(1).max(200).default(50),
        }),
        execute: async ({ sql, params, maxRows }) => {
          const validatedSql = assertReadOnlySql(sql);
          const limitedSql = applyReadLimit(validatedSql, maxRows);
          const result = await runQuery(limitedSql, (params ?? []) as SqlParam[]);

          return {
            rowCount: result.rowCount,
            rows: result.rows,
          };
        },
      }),
      sql_ejecutar: tool({
        description:
          'Ejecuta una mutacion SQL controlada (INSERT/UPDATE/DELETE). Requiere SQL_ADMIN_ENABLED=true.',
        inputSchema: z.object({
          sql: z
            .string()
            .min(1)
            .describe('Sentencia SQL de escritura unica (INSERT, UPDATE o DELETE) con placeholders.'),
          params: sqlParamsSchema.describe('Parametros opcionales para placeholders SQL ($1, $2, etc.).'),
        }),
        execute: async ({ sql, params }) => {
          const validatedSql = assertMutationSql(sql);
          const result = await runQuery(validatedSql, (params ?? []) as SqlParam[]);

          return {
            command: result.command,
            rowCount: result.rowCount,
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
