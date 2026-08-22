/**
 * Embedding Helper
 * Uses Gemini text-embedding-004 for query embeddings.
 * Passage embeddings are pre-computed and cached.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
const BATCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`;

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text) {
  if (!GEMINI_API_KEY) {
    // Fallback: generate a deterministic pseudo-embedding for demo
    return generateFallbackEmbedding(text);
  }

  try {
    const response = await fetch(EMBEDDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          parts: [{ text }]
        }
      })
    });

    if (!response.ok) {
      console.warn('Embedding API error, using fallback:', response.status);
      return generateFallbackEmbedding(text);
    }

    const data = await response.json();
    return data.embedding?.values || generateFallbackEmbedding(text);
  } catch (error) {
    console.warn('Embedding generation failed, using fallback:', error.message);
    return generateFallbackEmbedding(text);
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateBatchEmbeddings(texts) {
  if (!GEMINI_API_KEY) {
    return texts.map(t => generateFallbackEmbedding(t));
  }

  try {
    const requests = texts.map(text => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text }]
      }
    }));

    const response = await fetch(BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });

    if (!response.ok) {
      console.warn('Batch embedding API error, using fallback');
      return texts.map(t => generateFallbackEmbedding(t));
    }

    const data = await response.json();
    return data.embeddings?.map(e => e.values) || texts.map(t => generateFallbackEmbedding(t));
  } catch (error) {
    console.warn('Batch embedding failed, using fallback:', error.message);
    return texts.map(t => generateFallbackEmbedding(t));
  }
}

/**
 * Fallback: deterministic pseudo-embedding based on text features
 * This creates a 256-dimensional vector that captures word-level features
 */
function generateFallbackEmbedding(text, dim = 256) {
  const words = text.toLowerCase().split(/\s+/);
  const vec = new Float32Array(dim);
  
  // Simple but deterministic: hash each word to vector positions
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const charCode = word.charCodeAt(i);
      const pos1 = (charCode * 31 + i * 7) % dim;
      const pos2 = (charCode * 17 + i * 13) % dim;
      const pos3 = (charCode * 41 + i * 3) % dim;
      vec[pos1] += 0.1;
      vec[pos2] += 0.05;
      vec[pos3] -= 0.03;
    }
  }
  
  // Normalize to unit vector
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  
  return Array.from(vec);
}
