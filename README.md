# Next.js AI Agent Demo

Ejemplo mínimo de un agente con:

- Next.js (App Router)
- TypeScript
- Vercel AI SDK
- OpenAI
- Tool calling
- Streaming

## Requisitos

- Node.js 18+
- Una API key de OpenAI

## Instalación

```bash
npm install
cp .env.example .env.local
```

Configura tus variables en .env.local:

```bash
OPENAI_API_KEY=tu_api_key_aqui
DATABASE_URL=postgres://usuario:password@host:5432/tu_base
SQL_ADMIN_ENABLED=false
```

## Integracion SQL En El Agente

El endpoint del agente en [src/app/api/chat/route.ts](src/app/api/chat/route.ts) ahora incluye herramientas SQL:

- sql_listar_tablas: enumera tablas del esquema public
- sql_consultar: ejecuta SELECT/CTE de solo lectura con limite de filas
- sql_ejecutar: permite INSERT/UPDATE/DELETE solo si SQL_ADMIN_ENABLED=true

Seguridad aplicada por defecto:

- Bloqueo de multiples sentencias por herramienta
- Bloqueo de DDL/admin (DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE)
- Limite de resultados de lectura entre 1 y 200 filas

## Agente Mixto Para Artes Visuales

La interfaz principal en [src/app/page.tsx](src/app/page.tsx) ahora permite elegir modo:

- Soy profesor
- Soy estudiante

El backend en [src/app/api/chat/route.ts](src/app/api/chat/route.ts) adapta prompt, tono y herramientas segun ese modo.

Tools pedagogicas implementadas:

- crear_rubrica
- sugerir_actividad
- adaptar_lenguaje
- alinear_objetivo_curricular

Tools artisticas implementadas:

- analizar_elementos_visuales
- buscar_referentes_artistico
- generar_consigna_creativa

Reglas por modo:

- Profesor: puede usar herramientas pedagogicas y SQL
- Estudiante: recibe tutoria formativa y no accede a herramientas SQL

Nota sobre analisis de imagen:

- Esta version base trabaja con descripcion textual de la obra.
- El siguiente paso recomendado es incorporar carga de imagen y enviarla al modelo multimodal en el endpoint de chat.

## Desarrollo

```bash
npm run dev
```

Abre http://localhost:3000.
