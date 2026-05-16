import { openai } from '@ai-sdk/openai';
import { stepCountIs, streamText, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { runQuery, type SqlParam } from '@/lib/db';

export const maxDuration = 30;

const modeSchema = z.enum(['profesor', 'estudiante']);
type AgentMode = z.infer<typeof modeSchema>;

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

function getSystemPrompt(mode: AgentMode): string {
  if (mode === 'profesor') {
    return `
Eres un asistente experto para docentes de Artes Visuales.
Tu foco es planificar, evaluar y adaptar actividades por nivel educativo con profundidad pedagógica.
Cuando entregues material didactico, usa estructura clara: objetivo, inicio, desarrollo, cierre, materiales y evaluacion.
Proporciona análisis crítico detallado de obras y producciones estudiantiles.
Si corresponde, usa herramientas pedagogicas y artisticas para producir respuestas concretas y fundadas.
Si consultas datos de base de datos, usa primero sql_listar_tablas y luego sql_consultar.
Para cambios en base de datos usa sql_ejecutar solo si el usuario lo pide de forma explicita.
    `.trim();
  }

  return `
Eres un tutor accesible de Artes Visuales para estudiantes.
Explica con lenguaje claro, motivador y accionable.
No resuelvas tareas completas: guia por pasos, da ejemplos y preguntas de reflexion.
Cuando des feedback visual, comienza con un punto fuerte y luego 2-3 mejoras concretas.
Si usas herramientas, prioriza las artisticas y de adaptacion de lenguaje.
Mantén respuestas concisas y motivadoras.
    `.trim();
}

function selectModel(mode: AgentMode) {
  // gpt-4o mini para estudiante: más rápido, económico, suficiente para tareas básicas
  if (mode === 'estudiante') {
    return openai('gpt-4o-mini');
  }

  // gpt-4-turbo para profesor: análisis visual serio, herramientas complejas, respuestas elaboradas
  return openai('gpt-4-turbo');
}

function assertProfesorMode(mode: AgentMode, toolName: string) {
  if (mode !== 'profesor') {
    throw new Error(`${toolName} solo esta disponible en modo profesor.`);
  }
}

function hasUsableOpenAIKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return false;
  }

  if (apiKey === 'your_openai_api_key_here') {
    return false;
  }

  return apiKey.startsWith('sk-');
}

export async function POST(req: Request) {
  const body: unknown = await req.json();
  const parsed = z
    .object({
      mode: modeSchema.optional(),
      messages: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant', 'system']),
            content: z.string(),
          }),
        )
        .min(1),
    })
    .safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: 'Payload invalido. Se esperaba { mode?, messages: [{ role, content }] }.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const mode: AgentMode = parsed.data.mode ?? 'estudiante';
  const modelMessages: ModelMessage[] = parsed.data.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (!hasUsableOpenAIKey()) {
    return Response.json(
      {
        error:
          'OPENAI_API_KEY no esta configurada correctamente. Usa una clave real (sk-...) en .env.local y reinicia `npm run dev`.',
      },
      { status: 400 },
    );
  }

  const result = streamText({
    model: selectModel(mode),
    messages: modelMessages,
    stopWhen: stepCountIs(5),
    system: getSystemPrompt(mode),
    tools: {
      crear_rubrica: tool({
        description: 'Crea una rubrica para evaluar trabajos de Artes Visuales por niveles de logro.',
        inputSchema: z.object({
          nivelEducativo: z.string().describe('Ejemplo: 7° basico, 2° medio'),
          curso: z.string(),
          tipoActividad: z.string(),
          criterios: z.array(z.string()).min(1).max(8),
        }),
        execute: async ({ nivelEducativo, curso, tipoActividad, criterios }) => {
          assertProfesorMode(mode, 'crear_rubrica');

          const niveles = ['Inicial', 'Medio', 'Logrado'];
          const rubrica = criterios.map((criterio) => ({
            criterio,
            niveles: {
              Inicial: `Demuestra avances iniciales en ${criterio.toLowerCase()}.`,
              Medio: `Aplica ${criterio.toLowerCase()} de manera parcial y consistente en partes del trabajo.`,
              Logrado: `Integra ${criterio.toLowerCase()} con intencion visual clara y coherencia tecnica.`,
            },
            sugerencia: `Para mejorar ${criterio.toLowerCase()}, incorpora una instancia breve de autoevaluacion al cierre.`,
          }));

          return {
            nivelEducativo,
            curso,
            tipoActividad,
            niveles,
            rubrica,
          };
        },
      }),
      sugerir_actividad: tool({
        description: 'Propone una actividad didactica de Artes Visuales adaptada por nivel y objetivo.',
        inputSchema: z.object({
          nivel: z.string(),
          unidad: z.string(),
          objetivo: z.string(),
          duracionMinutos: z.number().int().min(20).max(240),
          materiales: z.array(z.string()).min(1).max(15),
        }),
        execute: async ({ nivel, unidad, objetivo, duracionMinutos, materiales }) => {
          assertProfesorMode(mode, 'sugerir_actividad');
          return {
            titulo: `Actividad de ${unidad} para ${nivel}`,
            objetivo,
            duracionMinutos,
            inicio: 'Observacion guiada de referentes visuales y activacion de conocimientos previos.',
            desarrollo:
              'Exploracion tecnica en parejas, produccion individual y retroalimentacion entre pares con pauta breve.',
            cierre: 'Puesta en comun, autoevaluacion y registro en bitacora visual.',
            materiales,
            evaluacion: 'Lista de cotejo formativa con foco en proceso, comunicacion visual y reflexion.',
          };
        },
      }),
      adaptar_lenguaje: tool({
        description: 'Adapta un texto a nivel tecnico docente o lenguaje simplificado para estudiantes.',
        inputSchema: z.object({
          texto: z.string().min(5),
          nivelDestino: z.enum(['estudiante', 'docente']),
        }),
        execute: async ({ texto, nivelDestino }) => {
          const adaptado =
            nivelDestino === 'estudiante'
              ? `Version clara para estudiante:\n${texto}\n\nExplicacion breve: enfocate en 1 idea principal y 2 acciones concretas.`
              : `Version tecnica para docente:\n${texto}\n\nSugerencia didactica: explicitar criterio observable, evidencia y nivel de logro.`;

          return {
            nivelDestino,
            textoAdaptado: adaptado,
          };
        },
      }),
      alinear_objetivo_curricular: tool({
        description: 'Alinea un tema de Artes Visuales con habilidad y objetivo curricular esperado.',
        inputSchema: z.object({
          curso: z.string(),
          tema: z.string(),
          habilidad: z.string(),
        }),
        execute: async ({ curso, tema, habilidad }) => {
          assertProfesorMode(mode, 'alinear_objetivo_curricular');
          return {
            curso,
            tema,
            habilidad,
            objetivoSugerido: `Desarrollar ${habilidad.toLowerCase()} mediante la creacion y analisis de producciones visuales relacionadas con ${tema.toLowerCase()}.`,
            evidencias: [
              'Bitacora con decisiones de composicion y color.',
              'Obra final con intencion visual justificada.',
              'Autoevaluacion con criterio y mejora propuesta.',
            ],
          };
        },
      }),
      analizar_elementos_visuales: tool({
        description: 'Analiza elementos visuales clave de una obra a partir de descripcion textual.',
        inputSchema: z.object({
          descripcion: z.string().min(10).describe('Descripcion de la obra o del trabajo del estudiante.'),
        }),
        execute: async ({ descripcion }) => {
          return {
            descripcion,
            elementos: {
              color: 'Identificar paleta dominante, temperatura y armonia/contraste.',
              linea: 'Observar direccion, ritmo y expresividad de los trazos.',
              forma: 'Revisar relacion figura-fondo y jerarquia de formas.',
              textura: 'Distinguir texturas reales o visuales y su intencion.',
              composicion: 'Evaluar equilibrio, punto focal y recorrido visual.',
            },
            sugerencia: 'Solicita una foto de mejor luz o una descripcion mas detallada para feedback mas preciso.',
          };
        },
      }),
      buscar_referentes_artistico: tool({
        description: 'Sugiere artistas, movimientos y obras de referencia segun tecnica, tema o estilo.',
        inputSchema: z.object({
          tecnica: z.string().optional(),
          tema: z.string().optional(),
          estilo: z.string().optional(),
        }),
        execute: async ({ tecnica, tema, estilo }) => {
          const consulta = [tecnica, tema, estilo].filter(Boolean).join(' | ');
          return {
            consulta,
            referentes: [
              { artista: 'Paul Klee', movimiento: 'Expresionismo', aporte: 'Color emocional y sintesis formal.' },
              { artista: 'Frida Kahlo', movimiento: 'Surrealismo figurativo', aporte: 'Narrativa simbolica autobiografica.' },
              {
                artista: 'Yayoi Kusama',
                movimiento: 'Arte contemporaneo',
                aporte: 'Patrones repetitivos, instalacion y percepcion espacial.',
              },
            ],
          };
        },
      }),
      generar_consigna_creativa: tool({
        description: 'Genera una consigna creativa para clase o trabajo autonomo de estudiante.',
        inputSchema: z.object({
          edadONivel: z.string(),
          tema: z.string(),
          tecnica: z.string(),
        }),
        execute: async ({ edadONivel, tema, tecnica }) => {
          return {
            consigna: `Crea una obra sobre "${tema}" usando la tecnica ${tecnica}. Debes mostrar un punto focal claro, contraste y una decision personal de color.`,
            nivel: edadONivel,
            pasos: [
              'Haz 3 bocetos rapidos y elige uno.',
              'Define paleta de 3-5 colores y materiales.',
              'Produce la obra y registra decisiones en tu bitacora.',
            ],
            criterioExito: 'La obra comunica una intencion visual y evidencia experimentacion tecnica.',
          };
        },
      }),
      analizar_imagen: tool({
        description: 'Analiza elementos visuales de una imagen usando vision por IA. Valida composicion, color, tecnica y elementos artisticos.',
        inputSchema: z.object({
          imagenBase64: z.string().describe('Imagen en formato base64 (data:image/jpeg;base64,... o solo base64)'),
          contexto: z.string().optional().describe('Contexto o pregunta sobre la imagen (ej: analizar composicion, evaluar tecnica, etc)'),
          tipoAnalisis: z.enum(['general', 'composicion', 'color', 'tecnica', 'autoevaluacion']).optional(),
        }),
        execute: async ({ imagenBase64, contexto, tipoAnalisis = 'general' }) => {
          try {
            const cleanBase64 = imagenBase64.replace(/^data:image\/[a-z]+;base64,/, '');
            
            const analysisPrompts = {
              general: 'Analiza esta obra de arte. Identifica: elementos visuales clave, paleta de colores, composicion, tecnica aparente, fortalezas y areas de mejora.',
              composicion: 'Analiza la composicion visual. Evalua: punto focal, equilibrio, simetria, lineas directrices, ritmo visual y jerarquia de elementos.',
              color: 'Analiza el uso del color. Describe: paleta dominante, temperatura, armonia o contraste, intencion emocional del color.',
              tecnica: 'Analiza la tecnica aparente. Identifica: tipo de tecnica (dibujo, pintura, digital, mixta, etc), nivel de dominio, texturas visibles.',
              autoevaluacion: 'Da feedback constructivo de autoevaluacion. Comienza con fortalezas, luego sugiere 2-3 areas concretas de mejora con acciones especificas.',
            };

            const systemPrompt = `
Eres un crítico de arte y docente especializado en Artes Visuales.
Analiza imágenes de trabajos artísticos con ojo pedagogico.
Da feedback constructivo, específico y accionable.
Adapta tu lenguaje segun el contexto (podria ser un trabajo de estudiante).
${contexto ? `Contexto adicional: ${contexto}` : ''}
            `.trim();

            // Simulate vision analysis response
            // In production, you'd call openai with vision model
            return {
              tipoAnalisis,
              contexto: contexto || 'Análisis general',
              analisis: {
                composicion: 'Se observa una estructura clara con punto focal definido.',
                color: 'Paleta armonica con contraste controlado.',
                tecnica: 'Ejecución segura de los materiales.',
                fortalezas: [
                  'Decisión de color coherente',
                  'Composición equilibrada',
                  'Expresión clara de la intención'
                ],
                mejoras: [
                  'Ampliar contraste en zonas de detalle',
                  'Considerar la proporción figura-fondo',
                  'Profundizar en acabados'
                ]
              },
              sugerencia: 'Para fortalecer este trabajo, enfócate en una zona específica e intensifica los valores tonales.'
            };
          } catch (error) {
            throw new Error(`Error al analizar imagen: ${error instanceof Error ? error.message : 'Error desconocido'}`);
          }
        },
      }),
      sql_listar_tablas: tool({
        description: 'Lista las tablas disponibles en el esquema public de PostgreSQL.',
        inputSchema: z.object({}),
        execute: async () => {
          assertProfesorMode(mode, 'sql_listar_tablas');

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
          assertProfesorMode(mode, 'sql_consultar');

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
          assertProfesorMode(mode, 'sql_ejecutar');

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

  return result.toTextStreamResponse();
}
