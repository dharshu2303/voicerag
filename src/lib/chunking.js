/**
 * Multi-Strategy Chunking Engine
 * Implements 4 distinct chunking strategies for the RAG pipeline:
 * 1. Fixed-Size: Token-based with overlap
 * 2. Semantic: Topic-boundary splitting
 * 3. Sentence-Window: Sentence + surrounding context
 * 4. Metadata-Aware: Respects dataset structure
 */

// ─── Strategy 1: Fixed-Size Chunking ─────────────────────────────────────
function fixedSizeChunk(text, { chunkSize = 200, overlap = 50 } = {}) {
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) {
      chunks.push({
        text: chunk,
        strategy: 'fixed',
        start_word: i,
        end_word: Math.min(i + chunkSize, words.length),
        overlap_words: overlap
      });
    }
    if (i + chunkSize >= words.length) break;
  }
  
  return chunks.length > 0 ? chunks : [{ text, strategy: 'fixed', start_word: 0, end_word: words.length, overlap_words: 0 }];
}

// ─── Strategy 2: Semantic Chunking ────────────────────────────────────────
function semanticChunk(text, { minChunkSize = 50, maxChunkSize = 300 } = {}) {
  // Split by semantic boundaries: paragraphs, topic shifts, sentence clusters
  const sentences = splitSentences(text);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceWords = sentence.split(/\s+/).length;
    
    // Detect topic shift using keyword overlap
    const hasTopicShift = i > 0 && detectTopicShift(sentences[i - 1], sentence);
    
    if ((hasTopicShift && currentLength >= minChunkSize) || currentLength + sentenceWords > maxChunkSize) {
      if (currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.join(' '),
          strategy: 'semantic',
          sentence_count: currentChunk.length,
          topic_boundary: hasTopicShift
        });
      }
      currentChunk = [sentence];
      currentLength = sentenceWords;
    } else {
      currentChunk.push(sentence);
      currentLength += sentenceWords;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join(' '),
      strategy: 'semantic',
      sentence_count: currentChunk.length,
      topic_boundary: false
    });
  }
  
  return chunks.length > 0 ? chunks : [{ text, strategy: 'semantic', sentence_count: 1, topic_boundary: false }];
}

// ─── Strategy 3: Sentence-Window Chunking ─────────────────────────────────
function sentenceWindowChunk(text, { windowSize = 2 } = {}) {
  const sentences = splitSentences(text);
  const chunks = [];
  
  for (let i = 0; i < sentences.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(sentences.length, i + windowSize + 1);
    const window = sentences.slice(start, end);
    
    chunks.push({
      text: window.join(' '),
      strategy: 'sentence_window',
      center_sentence: sentences[i],
      window_start: start,
      window_end: end - 1,
      context_sentences: window.length
    });
  }
  
  return chunks.length > 0 ? chunks : [{ text, strategy: 'sentence_window', center_sentence: text, window_start: 0, window_end: 0, context_sentences: 1 }];
}

// ─── Strategy 4: Metadata-Aware Chunking ──────────────────────────────────
function metadataAwareChunk(text, metadata = {}) {
  const { query_type, source_query, is_selected } = metadata;
  const sentences = splitSentences(text);
  const chunks = [];
  
  // Strategy varies by query type
  switch (query_type) {
    case 'NUMERIC':
      // For numeric queries, create tight chunks around numbers
      chunks.push(...extractNumericChunks(sentences, metadata));
      break;
    case 'PERSON':
      // For person queries, chunk by biographical segments
      chunks.push(...extractBiographicalChunks(sentences, metadata));
      break;
    case 'LOCATION':
      // For location queries, keep geographic context together
      chunks.push(...extractLocationChunks(sentences, metadata));
      break;
    default:
      // For DESCRIPTION/ENTITY, use paragraph-aware splitting
      chunks.push(...extractDescriptionChunks(sentences, metadata));
  }
  
  // Add metadata to all chunks
  return chunks.map(c => ({
    ...c,
    strategy: 'metadata_aware',
    query_type,
    source_query,
    is_selected: is_selected ?? false
  }));
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());
}

function detectTopicShift(prev, current) {
  const prevWords = new Set(prev.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const currWords = new Set(current.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  
  let overlap = 0;
  for (const w of prevWords) {
    if (currWords.has(w)) overlap++;
  }
  
  const maxSize = Math.max(prevWords.size, currWords.size, 1);
  return (overlap / maxSize) < 0.15; // Low overlap = topic shift
}

function extractNumericChunks(sentences, metadata) {
  const chunks = [];
  const numericPattern = /\d[\d,.]*\s*(km|m|ft|miles|metres|meters|years|kg|lbs|gallons|percent|%|billion|million|thousand)/gi;
  
  for (let i = 0; i < sentences.length; i++) {
    if (numericPattern.test(sentences[i])) {
      const start = Math.max(0, i - 1);
      const end = Math.min(sentences.length, i + 2);
      chunks.push({
        text: sentences.slice(start, end).join(' '),
        has_numeric: true,
        center_index: i
      });
    }
  }
  
  if (chunks.length === 0) {
    chunks.push({ text: sentences.join(' '), has_numeric: false, center_index: 0 });
  }
  
  return chunks;
}

function extractBiographicalChunks(sentences, metadata) {
  const chunks = [];
  const bioMarkers = ['born', 'known', 'discovered', 'invented', 'awarded', 'received', 'served', 'became', 'died', 'founded'];
  
  let currentGroup = [];
  for (const sentence of sentences) {
    const hasBioMarker = bioMarkers.some(m => sentence.toLowerCase().includes(m));
    
    if (hasBioMarker && currentGroup.length > 0) {
      chunks.push({ text: currentGroup.join(' '), bio_segment: true });
      currentGroup = [sentence];
    } else {
      currentGroup.push(sentence);
    }
  }
  
  if (currentGroup.length > 0) {
    chunks.push({ text: currentGroup.join(' '), bio_segment: true });
  }
  
  return chunks;
}

function extractLocationChunks(sentences, metadata) {
  const chunks = [];
  // Keep location context together with measurements
  const fullText = sentences.join(' ');
  chunks.push({ text: fullText, geo_context: true });
  
  // Also create a focused chunk if there are measurements
  const measurementSentences = sentences.filter(s => 
    /\d[\d,.]*\s*(km|miles|metres|square|sq)/i.test(s)
  );
  
  if (measurementSentences.length > 0) {
    chunks.push({ text: measurementSentences.join(' '), geo_measurements: true });
  }
  
  return chunks;
}

function extractDescriptionChunks(sentences, metadata) {
  // Group sentences into logical paragraphs of 2-3 sentences
  const chunks = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const group = sentences.slice(i, Math.min(i + 3, sentences.length));
    chunks.push({ text: group.join(' '), desc_group: true });
  }
  return chunks;
}

// ─── Main Chunking Engine ─────────────────────────────────────────────────
export function chunkPassage(passage) {
  const { text, query_type, source_query, is_selected, id } = passage;
  
  const allChunks = {
    fixed: fixedSizeChunk(text),
    semantic: semanticChunk(text),
    sentence_window: sentenceWindowChunk(text),
    metadata_aware: metadataAwareChunk(text, { query_type, source_query, is_selected })
  };
  
  // Flatten all chunks with passage reference
  const flatChunks = [];
  for (const [strategy, chunks] of Object.entries(allChunks)) {
    chunks.forEach((chunk, idx) => {
      flatChunks.push({
        ...chunk,
        chunk_id: `${id}_${strategy}_${idx}`,
        passage_id: id,
        passage_text: text
      });
    });
  }
  
  return { byStrategy: allChunks, flat: flatChunks };
}

export function chunkAllPassages(passages) {
  const allChunks = [];
  const byStrategy = { fixed: [], semantic: [], sentence_window: [], metadata_aware: [] };
  
  for (const passage of passages) {
    const result = chunkPassage(passage);
    allChunks.push(...result.flat);
    
    for (const [strategy, chunks] of Object.entries(result.byStrategy)) {
      byStrategy[strategy].push(...chunks.map((c, i) => ({
        ...c,
        chunk_id: `${passage.id}_${strategy}_${i}`,
        passage_id: passage.id,
        passage_text: passage.text
      })));
    }
  }
  
  return { allChunks, byStrategy };
}

export const STRATEGIES = ['fixed', 'semantic', 'sentence_window', 'metadata_aware'];
