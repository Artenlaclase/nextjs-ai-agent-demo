export const metadata = {
  title: 'Next.js AI Agent Demo',
  description: 'Demo de agente con Next.js, AI SDK y OpenAI',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          background: '#f3f4f6',
        }}
      >
        {children}
      </body>
    </html>
  );
}
