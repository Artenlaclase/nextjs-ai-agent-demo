'use client';

import { FormEvent, ChangeEvent, useState } from 'react';
import { generateUUID } from '@/lib/uuid';

type AgentMode = 'profesor' | 'estudiante';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
};

export default function AgentePage() {
  const [mode, setMode] = useState<AgentMode>('estudiante');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setSelectedImage(base64);
      setImagePreview(base64);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedInput = input.trim();
    if ((!trimmedInput && !selectedImage) || isLoading) return;

    const userContent = selectedImage
      ? `[IMAGEN ADJUNTA]\n${trimmedInput || 'Analiza esta imagen de mi trabajo.'}`
      : trimmedInput;

    const userMessage: ChatMessage = {
      id: generateUUID(),
      role: 'user',
      content: userContent,
      imageUrl: selectedImage || undefined,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setSelectedImage(null);
    setImagePreview(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode,
          messages: nextMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
      });

      if (!response.ok) {
        let serverError = `Error ${response.status}: no se pudo obtener una respuesta del agente.`;

        try {
          const errorPayload = (await response.json()) as { error?: string };
          if (errorPayload?.error) {
            serverError = errorPayload.error;
          }
        } catch {
          // Keep fallback error message when response is not JSON.
        }

        throw new Error(serverError);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('La respuesta no incluye un stream legible.');
      }

      const assistantId = generateUUID();
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
          id: generateUUID(),
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
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Arte en la Clase Agente IA</h1>
      <p style={{ color: '#4b5563', marginBottom: 24 }}>
        Agente mixto para Artes Visuales con modo Profesor y modo Estudiante. Puedes subir imágenes para análisis visual.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setMode('profesor')}
          style={{
            padding: '8px 14px',
            borderRadius: 999,
            border: mode === 'profesor' ? '1px solid #1d4ed8' : '1px solid #d1d5db',
            background: mode === 'profesor' ? '#dbeafe' : '#ffffff',
            color: '#1f2937',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Soy profesor
        </button>
        <button
          type="button"
          onClick={() => setMode('estudiante')}
          style={{
            padding: '8px 14px',
            borderRadius: 999,
            border: mode === 'estudiante' ? '1px solid #047857' : '1px solid #d1d5db',
            background: mode === 'estudiante' ? '#d1fae5' : '#ffffff',
            color: '#1f2937',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Soy estudiante
        </button>
      </div>

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
            {mode === 'profesor'
              ? 'Prueba con: Crea una actividad de 90 minutos sobre color y emociones para 7° básico. O sube una imagen para crear una rúbrica de evaluación.'
              : 'Prueba con: Mira mi dibujo y dime cómo mejorar la composición. Puedes subir una imagen de tu trabajo.'}
          </p>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} style={{ marginBottom: 16 }}>
            <strong style={{ color: message.role === 'user' ? '#2563eb' : '#059669' }}>
              {message.role === 'user' ? 'Tú: ' : 'Agente: '}
            </strong>
            {message.imageUrl ? (
              <div style={{ marginTop: 8 }}>
                <img
                  src={message.imageUrl}
                  alt="Imagen compartida"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 300,
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                />
              </div>
            ) : null}
            <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
          </div>
        ))}

        {isLoading ? (
          <div style={{ color: '#6b7280', fontStyle: 'italic' }}>
            El agente está respondiendo...
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {imagePreview ? (
          <div style={{ position: 'relative' }}>
            <img
              src={imagePreview}
              alt="Vista previa"
              style={{
                maxWidth: '100%',
                maxHeight: 200,
                borderRadius: 8,
                border: '2px solid #047857',
              }}
            />
            <button
              type="button"
              onClick={() => {
                setSelectedImage(null);
                setImagePreview(null);
              }}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                padding: '4px 8px',
                borderRadius: 6,
                border: 'none',
                background: 'rgba(0, 0, 0, 0.7)',
                color: 'white',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ✕ Quitar
            </button>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              mode === 'profesor'
                ? 'Ej: Crea una rúbrica para collage surrealista en 8° básico'
                : 'Ej: ¿Cómo puedo mejorar el contraste en mi afiche?'
            }
            style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              fontSize: 16,
            }}
          />
          <label
            style={{
              padding: '12px 18px',
              borderRadius: 10,
              border: '1px solid #6b7280',
              background: '#f3f4f6',
              color: '#1f2937',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            📷 Imagen
            <input
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
          </label>
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
        </div>
      </form>
    </main>
  );
}
