/**
 * Latency Tracker
 * Tracks per-stage and total pipeline latency.
 * Computes P50 / P70 / P100 percentiles in real-time.
 */

// Rolling window of latency measurements
const MAX_ENTRIES = 200;
let latencyLog = [];
let stageLatencyLog = {};

/**
 * Track a pipeline execution's latency
 */
export function trackLatency(totalMs, stages) {
  const entry = {
    timestamp: Date.now(),
    total_ms: totalMs,
    stages: stages.map(s => ({
      name: s.name,
      duration_ms: s.duration_ms,
      status: s.status
    }))
  };

  latencyLog.push(entry);
  if (latencyLog.length > MAX_ENTRIES) {
    latencyLog = latencyLog.slice(-MAX_ENTRIES);
  }

  // Track per-stage latencies
  for (const stage of stages) {
    if (!stageLatencyLog[stage.name]) {
      stageLatencyLog[stage.name] = [];
    }
    stageLatencyLog[stage.name].push(stage.duration_ms);
    if (stageLatencyLog[stage.name].length > MAX_ENTRIES) {
      stageLatencyLog[stage.name] = stageLatencyLog[stage.name].slice(-MAX_ENTRIES);
    }
  }
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil(sortedArr.length * (p / 100)) - 1;
  return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
}

/**
 * Get comprehensive latency statistics
 */
export function getLatencyStats() {
  if (latencyLog.length === 0) {
    return {
      total_queries: 0,
      pipeline: { p50: 0, p70: 0, p100: 0, mean: 0, min: 0, max: 0 },
      stages: {},
      recent: [],
      meets_target: true,
      target_ms: 200
    };
  }

  const totals = latencyLog.map(e => e.total_ms).sort((a, b) => a - b);
  
  const stats = {
    total_queries: latencyLog.length,
    pipeline: {
      p50: Math.round(percentile(totals, 50) * 100) / 100,
      p70: Math.round(percentile(totals, 70) * 100) / 100,
      p100: Math.round(percentile(totals, 100) * 100) / 100,
      mean: Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100,
      min: Math.round(totals[0] * 100) / 100,
      max: Math.round(totals[totals.length - 1] * 100) / 100
    },
    stages: {},
    recent: latencyLog.slice(-10).map(e => ({
      total_ms: Math.round(e.total_ms * 100) / 100,
      timestamp: e.timestamp,
      stages: e.stages
    })),
    meets_target: percentile(totals, 100) <= 200,
    target_ms: 200
  };

  // Per-stage stats
  for (const [name, values] of Object.entries(stageLatencyLog)) {
    const sorted = [...values].sort((a, b) => a - b);
    stats.stages[name] = {
      p50: Math.round(percentile(sorted, 50) * 100) / 100,
      p70: Math.round(percentile(sorted, 70) * 100) / 100,
      p100: Math.round(percentile(sorted, 100) * 100) / 100,
      mean: Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100) / 100,
      count: sorted.length
    };
  }

  return stats;
}

/**
 * Reset all latency tracking data
 */
export function resetLatencyStats() {
  latencyLog = [];
  stageLatencyLog = {};
}

/**
 * Get raw latency entries for chart rendering
 */
export function getLatencyHistory() {
  return latencyLog.map(e => ({
    total_ms: e.total_ms,
    timestamp: e.timestamp
  }));
}
