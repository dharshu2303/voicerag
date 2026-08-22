/**
 * In-Memory Vector Store
 * Fast cosine similarity search with pre-computed embeddings.
 * Combines vector similarity with BM25-style keyword scoring.
 */

class VectorStore {
  constructor() {
    this.chunks = [];
    this.embeddings = [];
    this.idfCache = {};
    this.initialized = false;
  }

  /**
   * Load chunks with their embeddings
   */
  load(chunks, embeddings) {
    this.chunks = chunks;
    this.embeddings = embeddings;
    this.buildIDF();
    this.initialized = true;
  }

  /**
   * Build IDF (Inverse Document Frequency) cache for BM25
   */
  buildIDF() {
    const docCount = this.chunks.length;
    const df = {};

    for (const chunk of this.chunks) {
      const words = new Set(chunk.text.toLowerCase().split(/\s+/));
      for (const word of words) {
        df[word] = (df[word] || 0) + 1;
      }
    }

    for (const [word, freq] of Object.entries(df)) {
      this.idfCache[word] = Math.log((docCount - freq + 0.5) / (freq + 0.5) + 1);
    }
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * BM25 score for keyword matching
   */
  bm25Score(query, chunkText) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const chunkWords = chunkText.toLowerCase().split(/\s+/);
    const chunkLength = chunkWords.length;
    const avgLength = this.chunks.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0) / Math.max(this.chunks.length, 1);

    const k1 = 1.5;
    const b = 0.75;
    let score = 0;

    const wordFreq = {};
    for (const w of chunkWords) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }

    for (const word of queryWords) {
      const tf = wordFreq[word] || 0;
      const idf = this.idfCache[word] || 0;
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (chunkLength / avgLength)));
      score += idf * tfNorm;
    }

    return score;
  }

  /**
   * Search with hybrid scoring: vector similarity + BM25
   */
  search(queryEmbedding, queryText, { topK = 5, vectorWeight = 0.7, bm25Weight = 0.3 } = {}) {
    if (!this.initialized) {
      throw new Error('Vector store not initialized. Call load() first.');
    }

    const results = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const vectorScore = this.cosineSimilarity(queryEmbedding, this.embeddings[i]);
      const keywordScore = this.bm25Score(queryText, this.chunks[i].text);
      
      // Normalize BM25 score to [0, 1] range approximately
      const normalizedBM25 = Math.min(keywordScore / 10, 1);
      
      const hybridScore = vectorWeight * vectorScore + bm25Weight * normalizedBM25;

      results.push({
        chunk: this.chunks[i],
        vectorScore,
        bm25Score: keywordScore,
        hybridScore,
        rank: 0
      });
    }

    // Sort by hybrid score descending
    results.sort((a, b) => b.hybridScore - a.hybridScore);

    // Assign ranks
    results.forEach((r, i) => r.rank = i + 1);

    return results.slice(0, topK);
  }

  /**
   * Multi-strategy search: search across different chunk strategies and merge
   */
  multiStrategySearch(queryEmbedding, queryText, chunksByStrategy, embeddingsByStrategy, { topK = 5 } = {}) {
    const strategyWeights = {
      fixed: 0.2,
      semantic: 0.3,
      sentence_window: 0.3,
      metadata_aware: 0.2
    };

    const allResults = new Map(); // passage_id -> best score

    for (const [strategy, chunks] of Object.entries(chunksByStrategy)) {
      const embeddings = embeddingsByStrategy[strategy];
      if (!chunks || !embeddings || chunks.length === 0) continue;

      // Temporarily set store data for this strategy
      const tempStore = new VectorStore();
      tempStore.load(chunks, embeddings);

      const results = tempStore.search(queryEmbedding, queryText, { topK: topK * 2 });
      const weight = strategyWeights[strategy] || 0.25;

      for (const result of results) {
        const passageId = result.chunk.passage_id;
        const existing = allResults.get(passageId);
        const weightedScore = result.hybridScore * weight;

        if (existing) {
          existing.totalScore += weightedScore;
          existing.strategies.push({ strategy, score: result.hybridScore });
          if (result.hybridScore > existing.bestChunkScore) {
            existing.bestChunk = result.chunk;
            existing.bestChunkScore = result.hybridScore;
          }
        } else {
          allResults.set(passageId, {
            passageId,
            bestChunk: result.chunk,
            bestChunkScore: result.hybridScore,
            totalScore: weightedScore,
            strategies: [{ strategy, score: result.hybridScore }]
          });
        }
      }
    }

    // Sort by total weighted score
    const sorted = Array.from(allResults.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, topK);

    return sorted;
  }

  getStats() {
    return {
      totalChunks: this.chunks.length,
      initialized: this.initialized,
      vocabSize: Object.keys(this.idfCache).length
    };
  }
}

// Singleton instance
let storeInstance = null;

export function getVectorStore() {
  if (!storeInstance) {
    storeInstance = new VectorStore();
  }
  return storeInstance;
}

export function createVectorStore() {
  return new VectorStore();
}
