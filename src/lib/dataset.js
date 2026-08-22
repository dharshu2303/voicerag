/**
 * Dataset Loader
 * Loads and prepares the MSMARCO-XI dataset subset.
 * Pre-chunks passages and pre-computes embeddings on first load.
 */

import { chunkAllPassages } from './chunking';
import { generateEmbedding } from './embeddings';
import { getVectorStore } from './vectorStore';
import datasetRaw from '../data/msmarco_sample.json';

let _initialized = false;
let _vectorStoreData = null;

/**
 * Initialize the dataset: chunk, embed, and load into vector store
 */
export async function initializeDataset() {
  if (_initialized && _vectorStoreData) {
    return _vectorStoreData;
  }

  console.log('[Dataset] Initializing MSMARCO-XI subset...');
  const startTime = performance.now();

  const passages = datasetRaw.passages;

  // Step 1: Chunk all passages with multiple strategies
  console.log('[Dataset] Chunking passages with 4 strategies...');
  const { allChunks, byStrategy } = chunkAllPassages(passages);
  console.log(`[Dataset] Created ${allChunks.length} total chunks across all strategies`);

  // Step 2: Generate embeddings for all chunks
  console.log('[Dataset] Generating embeddings...');
  const embeddingsByStrategy = {};
  
  for (const [strategy, chunks] of Object.entries(byStrategy)) {
    const embeddings = [];
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.text);
      embeddings.push(embedding);
    }
    embeddingsByStrategy[strategy] = embeddings;
    console.log(`[Dataset] Embedded ${chunks.length} ${strategy} chunks`);
  }

  // Step 3: Load all chunks into the vector store
  const store = getVectorStore();
  const allEmbeddings = [];
  for (const chunk of allChunks) {
    const embedding = await generateEmbedding(chunk.text);
    allEmbeddings.push(embedding);
  }
  store.load(allChunks, allEmbeddings);

  const elapsed = performance.now() - startTime;
  console.log(`[Dataset] Initialization complete in ${Math.round(elapsed)}ms`);
  console.log(`[Dataset] Store stats:`, store.getStats());

  _vectorStoreData = {
    store,
    chunksByStrategy: byStrategy,
    embeddingsByStrategy,
    passages,
    testQueries: datasetRaw.test_queries,
    metadata: datasetRaw.metadata
  };

  _initialized = true;
  return _vectorStoreData;
}

/**
 * Get the initialized dataset (throws if not initialized)
 */
export function getDataset() {
  if (!_initialized || !_vectorStoreData) {
    throw new Error('Dataset not initialized. Call initializeDataset() first.');
  }
  return _vectorStoreData;
}

export function isInitialized() {
  return _initialized;
}
