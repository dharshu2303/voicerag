import './globals.css';

export const metadata = {
  title: 'VoiceRAG — Speak. Retrieve. Answer.',
  description: 'Voice-Enabled RAG Pipeline — Speak a question, get a grounded answer powered by MSMARCO-XI dataset with multi-strategy chunking, guardrails, and blazing-fast retrieval.',
  keywords: 'RAG, voice, retrieval, AI, MSMARCO, vector search, guardrails',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#06080f" />
      </head>
      <body>
        <div className="bg-particles" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
