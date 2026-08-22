/**
 * Main RAG Pipeline API Route
 * POST: Accepts a query, runs the full pipeline, returns structured answer
 */

import { NextResponse } from 'next/server';
import { initializeDataset } from '@/lib/dataset';
import { runPipeline } from '@/lib/harness';

let initPromise = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initializeDataset().catch(err => {
      console.error('[Query API] Init failed:', err);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "query" field', success: false },
        { status: 400 }
      );
    }

    // Initialize dataset on first request
    const vectorStoreData = await ensureInitialized();

    // Run the full RAG pipeline through the harness
    const result = await runPipeline(query, vectorStoreData);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Query API] Error:', error);
    return NextResponse.json(
      {
        error: 'Pipeline execution failed',
        message: error.message,
        success: false
      },
      { status: 500 }
    );
  }
}
