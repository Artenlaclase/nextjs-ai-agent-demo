import { openai } from '@ai-sdk/openai';
import { streamText, tool, UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai('gpt-4.1'),
    messages: convertToModelMessages(messages),
    system: `
Eres un asistente útil y resolutivo.
Tienes acceso a herramientas externas.
Si el usuario pregunta algo que requiere consultar datos o ejecutar una acción,
usa la herramienta adecuada antes de responder.
Si la herramienta devuelve datos simulados, aclara que son de ejemplo.
    `.trim(),
    tools: {
      obtener_clima: tool({
        description: 'Obtiene el clima actual simulado de una ciudad específica.',
        parameters: z.object({
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
    },
  });

  return result.toDataStreamResponse();
}
