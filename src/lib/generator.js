/**
 * Answer Generator
 * Uses Gemini 2.5 Flash for fast, grounded answer generation.
 * Enforces answering ONLY from provided context.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are a precise question-answering assistant in a RAG (Retrieval-Augmented Generation) pipeline.

STRICT RULES:
1. Answer ONLY based on the provided context passages. Never use external knowledge.
2. If the context does not contain enough information to answer the question, say "I cannot find sufficient information in the provided context to answer this question."
3. Keep answers concise (2-4 sentences maximum).
4. When possible, cite which passage(s) support your answer.
5. Do not make assumptions or infer beyond what is explicitly stated in the passages.
6. If you're unsure, indicate your uncertainty rather than guessing.`;

/**
 * Generate a grounded answer from retrieved context
 */
export async function generateAnswer(query, retrievedChunks) {
  const context = retrievedChunks
    .map((chunk, i) => `[Passage ${i + 1}]: ${chunk.bestChunk?.text || chunk.text || chunk.chunk?.text || ''}`)
    .filter(p => p.length > 15)
    .join('\n\n');

  if (!context || context.trim().length < 20) {
    return {
      answer: 'No relevant passages were found to answer this question.',
      model: 'none',
      grounded: false,
      confidence: 0,
      tokens_used: 0
    };
  }

  const prompt = `Context Passages:\n${context}\n\nQuestion: ${query}\n\nProvide a concise, grounded answer based ONLY on the passages above.`;

  if (!GEMINI_API_KEY) {
    return generateFallbackAnswer(query, retrievedChunks);
  }

  try {
    const response = await fetch(GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 300,
          topP: 0.8,
          topK: 20
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.warn('Gemini API error:', response.status, error);
      return generateFallbackAnswer(query, retrievedChunks);
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokenCount = data.usageMetadata?.totalTokenCount || 0;

    return {
      answer: answer.trim(),
      model: MODEL,
      grounded: true,
      confidence: calculateConfidence(answer, retrievedChunks),
      tokens_used: tokenCount
    };
  } catch (error) {
    console.warn('Answer generation failed:', error.message);
    return generateFallbackAnswer(query, retrievedChunks);
  }
}

/**
 * Fallback answer generation using extracted context
 */
function generateFallbackAnswer(query, retrievedChunks) {
  const bestChunk = retrievedChunks[0];
  const text = bestChunk?.bestChunk?.text || bestChunk?.text || bestChunk?.chunk?.text || '';
  
  if (!text) {
    return {
      answer: 'No relevant information found.',
      model: 'fallback',
      grounded: false,
      confidence: 0,
      tokens_used: 0
    };
  }

  // Extract the most relevant sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  const scored = sentences.map(s => {
    const words = s.toLowerCase().split(/\s+/);
    const overlap = words.filter(w => queryWords.has(w)).length;
    return { text: s, score: overlap };
  });

  scored.sort((a, b) => b.score - a.score);
  
  // If zero word overlap (completely off-topic), do NOT return random passage text
  if (scored[0]?.score === 0) {
    return {
      answer: 'I cannot find sufficient information in the provided context to answer this question.',
      model: 'fallback-refused',
      grounded: false,
      confidence: 0,
      tokens_used: 0
    };
  }

  const answer = scored.slice(0, 3).map(s => s.text).join(' ');

  return {
    answer: answer || text.slice(0, 300),
    model: 'fallback-extractive',
    grounded: true,
    confidence: calculateConfidence(answer, retrievedChunks),
    tokens_used: 0
  };
}

/**
 * Calculate confidence based on answer-context overlap
 */
function calculateConfidence(answer, retrievedChunks) {
  if (!answer || retrievedChunks.length === 0) return 0;

  const answerWords = new Set(answer.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const contextWords = new Set();

  for (const chunk of retrievedChunks) {
    const text = chunk.bestChunk?.text || chunk.text || chunk.chunk?.text || '';
    text.toLowerCase().split(/\s+/).forEach(w => {
      if (w.length > 3) contextWords.add(w);
    });
  }

  if (answerWords.size === 0) return 0;

  let overlap = 0;
  for (const w of answerWords) {
    if (contextWords.has(w)) overlap++;
  }

  return Math.min(Math.round((overlap / answerWords.size) * 100), 100);
}
