/**
 * Benchmark API Route
 * GET: Returns current latency statistics
 * POST: Runs batch benchmark test queries
 */

import { NextResponse } from 'next/server';
import { initializeDataset } from '@/lib/dataset';
import { runPipeline } from '@/lib/harness';
import { getLatencyStats, resetLatencyStats } from '@/lib/latencyTracker';

let initPromise = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initializeDataset().catch(err => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function GET() {
  try {
    const stats = getLatencyStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    return NextResponse.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { queries, reset = false } = body;

    if (reset) {
      resetLatencyStats();
    }

    const vectorStoreData = await ensureInitialized();

    // Use provided queries or default test queries
    const testQueries = queries || vectorStoreData.testQueries || [
      'what was the manhattan project',
      'who was albert einstein',
      'how does photosynthesis work',
      'what is the speed of light',
      'how tall is mount everest'
    ];

    const results = [];
    for (const query of testQueries) {
      const result = await runPipeline(query, vectorStoreData);
      results.push({
        query,
        total_ms: result.pipeline?.total_ms,
        success: result.success,
        confidence: result.confidence,
        stages: result.pipeline?.stages
      });
    }

    const stats = getLatencyStats();

    return NextResponse.json({
      success: true,
      benchmark: {
        queries_run: results.length,
        results,
        stats
      }
    });
  } catch (error) {
    console.error('[Benchmark] Error:', error);
    return NextResponse.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}
