/**
 * Pipeline Harness
 * Structured orchestration around the RAG pipeline with:
 * - Input/output schema validation
 * - Retry logic with exponential backoff
 * - Stage-level timing and error tracking
 * - Graceful error recovery and fallback
 */

import { runInputGuardrails, runOutputGuardrails } from './guardrails';
import { generateEmbedding } from './embeddings';
import { generateAnswer } from './generator';
import { trackLatency, getLatencyStats } from './latencyTracker';

// ─── Pipeline Configuration ──────────────────────────────────────────────

const PIPELINE_CONFIG = {
  maxRetries: 3,
  baseBackoffMs: 100,
  maxBackoffMs: 2000,
  timeoutMs: 10000,
  topK: 5
};

// ─── Stage Executor ──────────────────────────────────────────────────────

async function executeStage(stageName, fn, options = {}) {
  const { maxRetries = PIPELINE_CONFIG.maxRetries, baseBackoffMs = PIPELINE_CONFIG.baseBackoffMs } = options;
  const start = performance.now();
  let lastError = null;
  let attempts = 0;

  for (let i = 0; i <= maxRetries; i++) {
    attempts = i + 1;
    try {
      const result = await fn();
      const duration = performance.now() - start;
      return {
        name: stageName,
        status: 'success',
        duration_ms: Math.round(duration * 100) / 100,
        result,
        attempts,
        error: null
      };
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        const backoff = Math.min(baseBackoffMs * Math.pow(2, i), PIPELINE_CONFIG.maxBackoffMs);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  const duration = performance.now() - start;
  return {
    name: stageName,
    status: 'failed',
    duration_ms: Math.round(duration * 100) / 100,
    result: null,
    attempts,
    error: lastError?.message || 'Unknown error'
  };
}

// ─── Input Validation ─────────────────────────────────────────────────────

function validateInput(query) {
  const errors = [];

  if (typeof query !== 'string') {
    errors.push('Query must be a string');
  } else {
    if (query.trim().length === 0) errors.push('Query cannot be empty');
    if (query.length > 1000) errors.push('Query exceeds maximum length of 1000 characters');
  }

  return {
    valid: errors.length === 0,
    sanitized: typeof query === 'string' ? query.trim().slice(0, 1000) : '',
    errors
  };
}

// ─── Output Formatting ───────────────────────────────────────────────────

function formatOutput(stages, result, metadata) {
  return {
    success: result !== null,
    answer: result?.answer || 'Unable to generate an answer.',
    sources: result?.sources || [],
    confidence: result?.confidence || 0,
    grounded: result?.grounded || false,
    model: result?.model || 'unknown',
    pipeline: {
      stages: stages.map(s => ({
        name: s.name,
        status: s.status,
        duration_ms: s.duration_ms,
        attempts: s.attempts,
        error: s.error
      })),
      total_ms: stages.reduce((sum, s) => sum + s.duration_ms, 0),
      timestamp: new Date().toISOString()
    },
    guardrails: metadata.guardrails || {},
    metadata: {
      retries: stages.reduce((sum, s) => sum + (s.attempts - 1), 0),
      strategies_used: metadata.strategies_used || [],
      chunks_retrieved: metadata.chunks_retrieved || 0
    }
  };
}

// ─── Main Pipeline ────────────────────────────────────────────────────────

export async function runPipeline(query, vectorStoreData) {
  const pipelineStart = performance.now();
  const stages = [];
  const metadata = {};

  // ─── Stage 0: Input Validation ──────────────────────────────
  const validation = validateInput(query);
  if (!validation.valid) {
    return formatOutput([], null, {
      guardrails: { input: { passed: false, errors: validation.errors } }
    });
  }

  const sanitizedQuery = validation.sanitized;

  // ─── Stage 1: Input Guardrails ──────────────────────────────
  const guardStage = await executeStage('guardrail_input', async () => {
    return runInputGuardrails(sanitizedQuery);
  }, { maxRetries: 0 }); // No retry for guardrails
  stages.push(guardStage);

  if (guardStage.status === 'failed') {
    return formatOutput(stages, null, { guardrails: { input: { passed: false, error: guardStage.error } } });
  }

  const inputGuardrails = guardStage.result;
  metadata.guardrails = { input: inputGuardrails };

  if (!inputGuardrails.passed) {
    return formatOutput(stages, {
      answer: inputGuardrails.checks.find(c => !c.passed)?.reason || 'Query was rejected by guardrails.',
      confidence: 0,
      grounded: false,
      sources: [],
      model: 'guardrail'
    }, metadata);
  }

  // ─── Stage 2: Query Embedding ───────────────────────────────
  const embedStage = await executeStage('embedding', async () => {
    return generateEmbedding(inputGuardrails.sanitizedQuery);
  });
  stages.push(embedStage);

  if (embedStage.status === 'failed') {
    return formatOutput(stages, null, metadata);
  }

  const queryEmbedding = embedStage.result;

  // ─── Stage 3: Multi-Strategy Retrieval ──────────────────────
  const retrieveStage = await executeStage('retrieval', async () => {
    const { store, chunksByStrategy, embeddingsByStrategy } = vectorStoreData;
    
    if (chunksByStrategy && embeddingsByStrategy) {
      return store.multiStrategySearch(
        queryEmbedding,
        inputGuardrails.sanitizedQuery,
        chunksByStrategy,
        embeddingsByStrategy,
        { topK: PIPELINE_CONFIG.topK }
      );
    }
    
    // Fallback to single-strategy search
    return store.search(queryEmbedding, inputGuardrails.sanitizedQuery, { topK: PIPELINE_CONFIG.topK });
  });
  stages.push(retrieveStage);

  if (retrieveStage.status === 'failed') {
    return formatOutput(stages, null, metadata);
  }

  const retrievedChunks = retrieveStage.result;
  metadata.chunks_retrieved = retrievedChunks.length;
  metadata.strategies_used = [...new Set(retrievedChunks.flatMap(c => c.strategies?.map(s => s.strategy) || []))];

  // ─── Stage 4: Answer Generation ─────────────────────────────
  const genStage = await executeStage('generation', async () => {
    return generateAnswer(inputGuardrails.sanitizedQuery, retrievedChunks);
  });
  stages.push(genStage);

  if (genStage.status === 'failed') {
    return formatOutput(stages, null, metadata);
  }

  const generated = genStage.result;

  // ─── Stage 5: Output Guardrails ─────────────────────────────
  const outputGuardStage = await executeStage('guardrail_output', async () => {
    return runOutputGuardrails(generated.answer, retrievedChunks);
  }, { maxRetries: 0 });
  stages.push(outputGuardStage);

  const outputGuardrails = outputGuardStage.result || { passed: true, finalAnswer: generated.answer, checks: [] };
  metadata.guardrails.output = outputGuardrails;

  // ─── Format Final Output ────────────────────────────────────
  const totalMs = performance.now() - pipelineStart;

  const sources = retrievedChunks.slice(0, 3).map((chunk, i) => ({
    rank: i + 1,
    text: (chunk.bestChunk?.text || chunk.text || chunk.chunk?.text || '').slice(0, 200),
    score: Math.round((chunk.totalScore || chunk.hybridScore || 0) * 1000) / 1000,
    passage_id: chunk.passageId || chunk.chunk?.passage_id || `source_${i}`,
    strategies: chunk.strategies?.map(s => s.strategy) || []
  }));

  const result = {
    answer: outputGuardrails.finalAnswer || generated.answer,
    confidence: generated.confidence,
    grounded: generated.grounded && (outputGuardrails.passed !== false),
    sources,
    model: generated.model
  };

  const output = formatOutput(stages, result, metadata);
  output.pipeline.total_ms = Math.round(totalMs * 100) / 100;

  // Track latency
  trackLatency(output.pipeline.total_ms, stages);

  return output;
}

export { PIPELINE_CONFIG };
