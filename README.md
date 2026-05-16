# nextjs-ai-agent-demo

Ejemplo mínimo de un agente con Next.js (App Router), Vercel AI SDK, OpenAI y tool calling con streaming.

## Requisitos

- Node.js 18+
- Una API key de OpenAI

## Instalación

```bash
npm install
cp .env.example .env.local
```

Configura tu clave en `.env.local`:

```bash
OPENAI_API_KEY=tu_api_key_aqui
```

## Desarrollo

```bash
npm run dev
```

Abre `http://localhost:3000`.

## Qué incluye

- `src/app/api/chat/route.ts`: backend del agente
- `src/app/page.tsx`: interfaz de chat
- Tool calling con una herramienta mock de clima
- Streaming de respuestas
