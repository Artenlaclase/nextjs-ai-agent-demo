'use client';

import { FormEvent, useState } from 'react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function AgentePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedInput,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: nextMessages,
        }),
      });

      if (!response.ok) {
        throw new Error('No se pudo obtener una respuesta del agente.');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('La respuesta no incluye un stream legible.');
      }

      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + chunk }
              : message,
          ),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Ocurrió un error inesperado.';

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${errorMessage}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Mi Primer Agente IA</h1>
      <p style={{ color: '#4b5563', marginBottom: 24 }}>
        Demo con Next.js App Router, Vercel AI SDK, tool calling y streaming.
      </p>

      <div
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          minHeight: 420,
          marginBottom: 16,
          overflowY: 'auto',
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: '#6b7280' }}>
            Prueba con: ¿Qué ropa me recomiendas para ir a Valparaíso hoy?
          </p>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} style={{ marginBottom: 16 }}>
            <strong style={{ color: message.role === 'user' ? '#2563eb' : '#059669' }}>
              {message.role === 'user' ? 'Tú: ' : 'Agente: '}
            </strong>
            <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
          </div>
        ))}

        {isLoading ? (
          <div style={{ color: '#6b7280', fontStyle: 'italic' }}>
            El agente está respondiendo...
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ej: ¿Cómo está el clima en Valparaíso?"
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid #d1d5db',
            fontSize: 16,
          }}
        />
        <button
          type="submit"
          disabled={isLoading}
          style={{
            padding: '12px 18px',
            borderRadius: 10,
            border: 'none',
            background: isLoading ? '#93c5fd' : '#2563eb',
            color: 'white',
            fontWeight: 600,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          Enviar
        </button>
      </form>
    </main>
  );
}
