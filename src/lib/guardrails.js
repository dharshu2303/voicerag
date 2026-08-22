/**
 * Guardrails System
 * Input and output guardrails for the RAG pipeline.
 * Handles: off-topic, unsafe content, language detection,
 * hallucination checking, confidence gating, grounding verification.
 */

// ─── Input Guardrails ─────────────────────────────────────────────────────

const UNSAFE_PATTERNS = [
  /\b(hack|exploit|attack|weapon|bomb|kill|murder|suicide|drug|narcotic)\b/i,
  /\b(password|credential|private.?key|secret.?key|api.?key)\b/i,
  /\b(porn|xxx|nude|nsfw|explicit)\b/i,
  /how\s+to\s+(make|build|create)\s+(bomb|weapon|explosive|poison)/i,
  /\b(terroris[mt]|extremis[mt])\b/i
];

const DOMAIN_KEYWORDS = [
  'what', 'who', 'where', 'when', 'how', 'why', 'which', 'describe', 'explain',
  'history', 'science', 'geography', 'person', 'place', 'thing', 'concept',
  'definition', 'meaning', 'cause', 'effect', 'impact', 'result',
  'manhattan', 'project', 'oppenheimer', 'einstein', 'curie', 'tesla',
  'photosynthesis', 'dna', 'evolution', 'gravity', 'quantum',
  'heart', 'brain', 'immune', 'eye', 'antibiotics',
  'everest', 'amazon', 'sahara', 'pacific', 'nile', 'mariana',
  'great wall', 'eiffel', 'barrier reef', 'renaissance', 'industrial',
  'climate', 'volcano', 'tsunami', 'earthquake', 'electricity',
  'solar system', 'moon', 'light', 'black hole', 'internet',
  'pythagorean', 'theorem', 'water cycle', 'artificial intelligence'
];

/**
 * Check if query contains unsafe/inappropriate content
 */
export function checkUnsafeInput(query) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(query)) {
      return {
        safe: false,
        reason: 'Query contains potentially unsafe or inappropriate content.',
        matched_pattern: pattern.toString()
      };
    }
  }
  return { safe: true, reason: null };
}

/**
 * Check if query is within the knowledge domain
 */
export function checkOnTopic(query) {
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);
  
  // Check for question-like structure
  const isQuestion = /[?]$/.test(query.trim()) || 
    /^(what|who|where|when|how|why|which|describe|explain|tell|define)\b/i.test(query.trim());
  
  // Check keyword overlap with domain
  let domainOverlap = 0;
  for (const keyword of DOMAIN_KEYWORDS) {
    if (queryLower.includes(keyword)) domainOverlap++;
  }

  // Very short queries (1-2 words) that aren't domain keywords
  if (words.length <= 2 && domainOverlap === 0) {
    return {
      onTopic: false,
      confidence: 0.3,
      reason: 'Query is too short and does not match any known topics in the knowledge base.'
    };
  }

  // No domain overlap and not a question
  if (domainOverlap === 0 && !isQuestion) {
    return {
      onTopic: false,
      confidence: 0.4,
      reason: 'Query does not appear to be a knowledge question within the dataset domain.'
    };
  }

  return {
    onTopic: true,
    confidence: Math.min(0.5 + domainOverlap * 0.1, 1.0),
    reason: null
  };
}

/**
 * Detect query language (simple heuristic)
 */
export function checkLanguage(query) {
  // Check for non-Latin scripts (Indic, CJK, Arabic, etc.)
  const nonLatinRatio = (query.match(/[^\x00-\x7F]/g) || []).length / query.length;
  
  if (nonLatinRatio > 0.5) {
    return {
      supported: true, // MSMARCO-XI supports Indic languages
      language: 'non-latin',
      note: 'Query appears to be in a non-Latin script. Processing in English mode.'
    };
  }

  return {
    supported: true,
    language: 'english',
    note: null
  };
}

/**
 * Run all input guardrails
 */
export function runInputGuardrails(query) {
  const results = {
    passed: true,
    checks: [],
    sanitizedQuery: query.trim()
  };

  // 1. Empty check
  if (!query || query.trim().length < 3) {
    results.passed = false;
    results.checks.push({
      name: 'empty_check',
      passed: false,
      reason: 'Query is too short. Please ask a complete question.'
    });
    return results;
  }

  // 2. Safety check
  const safety = checkUnsafeInput(query);
  results.checks.push({
    name: 'safety',
    passed: safety.safe,
    reason: safety.reason
  });
  if (!safety.safe) results.passed = false;

  // 3. On-topic check
  const topic = checkOnTopic(query);
  results.checks.push({
    name: 'on_topic',
    passed: topic.onTopic,
    confidence: topic.confidence,
    reason: topic.reason
  });
  // Don't hard-fail on off-topic, just warn
  if (!topic.onTopic) {
    results.checks.push({
      name: 'on_topic_warning',
      passed: true,
      reason: 'Query may be outside the knowledge domain. Results may be limited.'
    });
  }

  // 4. Language check
  const lang = checkLanguage(query);
  results.checks.push({
    name: 'language',
    passed: lang.supported,
    language: lang.language,
    reason: lang.note
  });

  // 5. Sanitize
  results.sanitizedQuery = query
    .trim()
    .replace(/[<>{}]/g, '') // Remove potential injection characters
    .slice(0, 500); // Max query length

  return results;
}

// ─── Output Guardrails ────────────────────────────────────────────────────

/**
 * Check for hallucination: verify answer content overlaps with context
 */
export function checkHallucination(answer, retrievedChunks) {
  if (!answer || retrievedChunks.length === 0) {
    return { hallucinated: true, overlapScore: 0, reason: 'No context available for verification.' };
  }

  // Extract significant words from answer (4+ chars, not stop words)
  const stopWords = new Set(['this', 'that', 'these', 'those', 'from', 'with', 'have', 'been', 'were', 'will', 'would', 'could', 'should', 'also', 'about', 'which', 'their', 'there', 'they', 'them', 'than', 'then', 'other', 'more', 'most', 'some', 'such', 'very', 'just', 'into', 'over', 'only']);
  
  const answerWords = answer.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
  const contextText = retrievedChunks
    .map(c => (c.bestChunk?.text || c.text || c.chunk?.text || '').toLowerCase())
    .join(' ');
  
  const contextWords = new Set(contextText.split(/\s+/));
  
  let grounded = 0;
  for (const word of answerWords) {
    if (contextWords.has(word)) grounded++;
  }

  const overlapScore = answerWords.length > 0 ? grounded / answerWords.length : 0;
  
  return {
    hallucinated: overlapScore < 0.3,
    overlapScore: Math.round(overlapScore * 100),
    reason: overlapScore < 0.3 
      ? 'Answer may contain information not present in the retrieved context.'
      : null
  };
}

/**
 * Check confidence: verify retrieval scores are above threshold
 */
export function checkConfidence(retrievedChunks, threshold = 0.3) {
  if (retrievedChunks.length === 0) {
    return {
      confident: false,
      topScore: 0,
      reason: 'No relevant passages were retrieved.'
    };
  }

  const topScore = retrievedChunks[0].totalScore || retrievedChunks[0].hybridScore || 0;
  
  return {
    confident: topScore >= threshold,
    topScore: Math.round(topScore * 100) / 100,
    reason: topScore < threshold 
      ? 'Retrieval confidence is too low. The knowledge base may not contain relevant information.'
      : null
  };
}

/**
 * Run all output guardrails
 */
export function runOutputGuardrails(answer, retrievedChunks) {
  const results = {
    passed: true,
    checks: [],
    finalAnswer: answer
  };

  // 1. Hallucination check
  const hallucination = checkHallucination(answer, retrievedChunks);
  results.checks.push({
    name: 'hallucination',
    passed: !hallucination.hallucinated,
    overlapScore: hallucination.overlapScore,
    reason: hallucination.reason
  });

  // 2. Confidence check
  const confidence = checkConfidence(retrievedChunks);
  results.checks.push({
    name: 'confidence',
    passed: confidence.confident,
    topScore: confidence.topScore,
    reason: confidence.reason
  });

  // 3. Empty answer check
  if (!answer || answer.trim().length < 10) {
    results.checks.push({
      name: 'empty_answer',
      passed: false,
      reason: 'Generated answer is too short or empty.'
    });
    results.passed = false;
  }

  // If hallucinated AND low confidence, refuse to answer
  if (hallucination.hallucinated && !confidence.confident) {
    results.passed = false;
    results.finalAnswer = 'I cannot provide a reliable answer to this question. The retrieved context does not contain sufficient relevant information, and the generated answer may not be grounded in facts.';
  }

  return results;
}
