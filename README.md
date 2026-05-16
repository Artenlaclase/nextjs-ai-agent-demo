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

## Desarrollo

```bash
npm run dev
```

Abre http://localhost:3000.
