'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mic, 
  Square, 
  ShieldCheck, 
  Dna, 
  Search, 
  Zap, 
  CheckCircle2, 
  MessageSquare, 
  FileText, 
  BarChart3, 
  Send
} from 'lucide-react';
import Particles, { ParticlesProvider } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

// ─── Pipeline Stage Configuration ──────────────────────────────────────────
const STAGE_CONFIG = {
  guardrail_input: { icon: ShieldCheck, label: 'Guard' },
  embedding: { icon: Dna, label: 'Embed' },
  retrieval: { icon: Search, label: 'Search' },
  generation: { icon: Zap, label: 'Generate' },
  guardrail_output: { icon: CheckCircle2, label: 'Verify' },
};
const STAGE_ORDER = ['guardrail_input', 'embedding', 'retrieval', 'generation', 'guardrail_output'];

export default function Home() {
  // ─── State ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [latencyStats, setLatencyStats] = useState(null);
  const [pipelineStages, setPipelineStages] = useState([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [error, setError] = useState(null);
  const [waveBars, setWaveBars] = useState(Array(30).fill(4));
  const [queryCount, setQueryCount] = useState(0);

  const recognitionRef = useRef(null);
  const animFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);

  // ─── Particles Init ────────────────────────────────────────────────────
  const particlesInit = useCallback(async (engine) => {
    await loadSlim(engine);
  }, []);

  // ─── Voice Input (Web Speech API) ──────────────────────────────────────
  const startRecording = useCallback(() => {
    setError(null);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported. Please use Chrome or type your question.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      setQuery(transcript);
    };
    recognition.onend = () => {
      setIsRecording(false);
      stopWaveform();
    };
    recognition.onerror = (e) => {
      setIsRecording(false);
      stopWaveform();
      if (e.error !== 'no-speech') setError(`Speech error: ${e.error}`);
    };

    recognition.start();
    recognitionRef.current = recognition;
    startWaveform();
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    stopWaveform();
  }, []);

  // ─── Waveform Animation ────────────────────────────────────────────────
  const startWaveform = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const updateBars = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 30 }, (_, i) => {
          const idx = Math.floor((i / 30) * (data.length / 2));
          return Math.max(4, (data[idx] / 255) * 60);
        });
        setWaveBars(bars);
        animFrameRef.current = requestAnimationFrame(updateBars);
      };
      updateBars();
    } catch {
      // Fallback: animated bars
      const fakeAnim = () => {
        setWaveBars(Array.from({ length: 30 }, () => 4 + Math.random() * 40));
        animFrameRef.current = requestAnimationFrame(fakeAnim);
      };
      fakeAnim();
    }
  }, []);

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    setWaveBars(Array(30).fill(4));
  }, []);

  // ─── Submit Query ──────────────────────────────────────────────────────
  const submitQuery = useCallback(async (q) => {
    const queryText = q || query;
    if (!queryText.trim() || isProcessing) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setPipelineStages(STAGE_ORDER.map(s => ({ name: s, status: 'pending' })));

    // Animate stages sequentially
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      setTimeout(() => {
        setPipelineStages(prev => prev.map((s, j) =>
          j === i ? { ...s, status: 'running' } : j < i ? { ...s, status: 'success' } : s
        ));
      }, i * 200);
    }

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Pipeline failed');

      setResult(data);
      setQueryCount(c => c + 1);
      setPipelineStages(
        (data.pipeline?.stages || []).map(s => ({
          name: s.name,
          status: s.status,
          duration_ms: s.duration_ms,
        }))
      );

      // Trigger SweetAlert popup if ungrounded / off-topic
      if (!data.grounded || data.confidence === 0) {
        Swal.fire({
          title: 'System Notice',
          text: data.answer || 'I cannot find sufficient information in the dataset to answer this question.',
          icon: 'warning',
          background: '#0d1117',
          color: '#e8eaf0',
          confirmButtonColor: '#7c3aed',
          customClass: {
            popup: 'glass-card-swal'
          }
        });
      }

      fetchLatencyStats();
    } catch (err) {
      setError(err.message);
      setPipelineStages(STAGE_ORDER.map(s => ({ name: s, status: 'failed' })));
    } finally {
      setIsProcessing(false);
    }
  }, [query, isProcessing]);

  // ─── Latency Stats ────────────────────────────────────────────────────
  const fetchLatencyStats = useCallback(async () => {
    try {
      const res = await fetch('/api/benchmark');
      const data = await res.json();
      if (data.success) setLatencyStats(data.stats);
    } catch { /* ignore */ }
  }, []);

  const runBenchmark = useCallback(async () => {
    setIsBenchmarking(true);
    setError(null);
    try {
      const res = await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (data.success) {
        setLatencyStats(data.benchmark.stats);
        setQueryCount(data.benchmark.stats.total_queries);
      }
    } catch (err) {
      setError('Benchmark failed: ' + err.message);
    } finally {
      setIsBenchmarking(false);
    }
  }, []);

  useEffect(() => { fetchLatencyStats(); }, [fetchLatencyStats]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuery();
    }
  };

  const confidence = result?.confidence || 0;
  const confColor = confidence >= 70 ? 'var(--accent-emerald)' : confidence >= 40 ? 'var(--accent-amber)' : 'var(--accent-rose)';

  // ─── Particles Config ──────────────────────────────────────────────────
  const particlesOptions = {
    background: { color: { value: "transparent" } },
    fpsLimit: 60,
    particles: {
      color: { value: ["#7c3aed", "#06b6d4", "#10b981"] },
      links: {
        color: "#7882b4",
        distance: 150,
        enable: true,
        opacity: 0.1,
        width: 1,
      },
      move: {
        enable: true,
        random: true,
        speed: 0.6,
        direction: "none",
        outModes: { default: "bounce" },
      },
      number: { density: { enable: true, area: 800 }, value: 40 },
      opacity: { value: 0.3 },
      shape: { type: "circle" },
      size: { value: { min: 1, max: 3 } },
    },
    detectRetina: true,
  };

  return (
    <main className="app-container">
      <ParticlesProvider init={particlesInit}>
        <Particles
          id="tsparticles"
          options={particlesOptions}
          className="bg-particles"
        />
      </ParticlesProvider>

      {/* Header */}
      <motion.header 
        className="app-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="logo-container">
          <Zap className="logo-icon" size={32} />
          <h1>VoiceRAG</h1>
        </div>
        <p>Enterprise Retrieval-Augmented Generation Pipeline</p>
        <div className="badge">
          <div className="pulse-dot"></div>
          MSMARCO-XI Dataset • Multi-Strategy • Guardrailed
        </div>
      </motion.header>

      <div className="content-grid">
        {/* Left Column */}
        <div className="left-col">
          {/* Voice Input */}
          <motion.section 
            className="voice-section glass-card"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="card-title">
              <Mic size={16} className="icon-mr" /> Voice Input
            </div>

            <div className="mic-container">
              <button
                className={`mic-btn ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                title={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {isRecording ? <Square size={32} /> : <span>🎤</span>}
              </button>
              
              <AnimatePresence>
                {isRecording && (
                  <motion.div 
                    className="waveform-container"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 60 }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    {waveBars.map((h, i) => (
                      <div key={i} className="wave-bar active" style={{ height: `${h}px` }} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className={`mic-status ${isRecording ? 'active' : ''}`}>
                {isRecording ? 'Listening... speak your query' : isProcessing ? 'Processing pipeline...' : 'Click to speak or type below'}
              </div>
            </div>

            <div className="text-input-area">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter query..."
                disabled={isProcessing}
              />
              <button
                className="submit-btn"
                onClick={() => submitQuery()}
                disabled={isProcessing || !query.trim()}
              >
                {isProcessing ? (
                  <span className="loading-dots"><span /><span /><span /></span>
                ) : (
                  <><Send size={16} className="icon-mr" /> Run</>
                )}
              </button>
            </div>
          </motion.section>

          {/* Latency Dashboard */}
          <motion.section 
            className="latency-section glass-card"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <div className="card-title">
              <BarChart3 size={16} className="icon-mr" /> System Analytics
            </div>

            <div className="latency-grid">
              <div className="latency-stat">
                <div className="label">P50 Latency</div>
                <div className="value">{latencyStats?.pipeline?.p50?.toFixed(0) || '—'}</div>
                <div className="unit">ms</div>
              </div>
              <div className="latency-stat">
                <div className="label">P70 Latency</div>
                <div className="value">{latencyStats?.pipeline?.p70?.toFixed(0) || '—'}</div>
                <div className="unit">ms</div>
              </div>
              <div className="latency-stat">
                <div className="label">P100 Latency</div>
                <div className="value">{latencyStats?.pipeline?.p100?.toFixed(0) || '—'}</div>
                <div className="unit">ms</div>
              </div>
            </div>

            {latencyStats?.recent?.length > 0 && (
              <div className="latency-chart">
                {latencyStats.recent.map((r, i) => {
                  const maxH = 60;
                  const h = Math.min((r.total_ms / 300) * maxH, maxH);
                  const cls = r.total_ms < 100 ? 'fast' : r.total_ms < 200 ? 'medium' : 'slow';
                  return (
                    <motion.div 
                      key={i} 
                      className={`chart-bar ${cls}`} 
                      style={{ height: `${h}px` }} 
                      title={`${r.total_ms.toFixed(1)}ms`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                    />
                  );
                })}
              </div>
            )}

            <div className="meta-row">
              <div className="meta-item">Queries: <span>{latencyStats?.total_queries || queryCount}</span></div>
              <div className="meta-item">Mean: <span>{latencyStats?.pipeline?.mean?.toFixed(1) || '—'}ms</span></div>
            </div>

            <button
              className="benchmark-btn"
              onClick={runBenchmark}
              disabled={isBenchmarking}
            >
              {isBenchmarking ? (
                <span className="loading-dots"><span /><span /><span /></span>
              ) : (
                'Run Evaluation Suite'
              )}
            </button>
          </motion.section>
        </div>

        {/* Right Column */}
        <div className="right-col">
          <AnimatePresence mode="wait">
            {pipelineStages.length > 0 ? (
              <motion.div 
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
                className="results-container"
              >
                {/* Pipeline Visualizer */}
                <section className="pipeline-section glass-card">
                  <div className="card-title">
                    <Zap size={16} className="icon-mr" /> Pipeline Execution
                  </div>
                  <div className="pipeline-stages">
                    {pipelineStages.map((stage, i) => {
                      const cfg = STAGE_CONFIG[stage.name] || { icon: CheckCircle2, label: stage.name };
                      const Icon = cfg.icon;
                      return (
                        <div key={stage.name} className="stage-wrapper">
                          {i > 0 && (
                            <motion.div 
                              className={`stage-connector ${stage.status === 'success' ? 'done' : stage.status === 'running' ? 'active' : ''}`}
                              initial={{ scaleX: 0, opacity: 0.2 }}
                              animate={{ 
                                scaleX: 1, 
                                opacity: stage.status === 'success' ? 1 : stage.status === 'running' ? [0.2, 1, 0.2] : 0.2 
                              }}
                              transition={
                                stage.status === 'running' 
                                  ? { opacity: { repeat: Infinity, duration: 1.5 }, scaleX: { duration: 0.4 } } 
                                  : { duration: 0.4 }
                              }
                            />
                          )}
                          <motion.div 
                            className="stage-node"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 200, damping: 15 }}
                          >
                            <motion.div 
                              className={`stage-dot ${stage.status}`}
                              animate={
                                stage.status === 'running' 
                                  ? { scale: [1, 1.15, 1], boxShadow: ["0 0 0px rgba(6,182,212,0)", "0 0 15px rgba(6,182,212,0.8)", "0 0 0px rgba(6,182,212,0)"] }
                                  : stage.status === 'success'
                                  ? { scale: [1.3, 1] }
                                  : stage.status === 'failed'
                                  ? { x: [-2, 2, -2, 2, 0], color: "#ef4444" }
                                  : {}
                              }
                              transition={
                                stage.status === 'running'
                                  ? { repeat: Infinity, duration: 1.2, ease: "easeInOut" }
                                  : stage.status === 'success'
                                  ? { type: "spring", stiffness: 300, damping: 10 }
                                  : { duration: 0.3 }
                              }
                            >
                              <Icon size={18} />
                            </motion.div>
                            <div className="stage-label">{cfg.label}</div>
                            {stage.duration_ms !== undefined && (
                              <div className="stage-time">{stage.duration_ms.toFixed(1)}ms</div>
                            )}
                          </motion.div>
                        </div>
                      );
                    })}
                  </div>
                  {result?.pipeline?.total_ms && (
                    <motion.div 
                      className="meta-row pipeline-meta"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      <div className="meta-item">Execution Time: <span>{result.pipeline.total_ms.toFixed(1)}ms</span></div>
                      <div className="meta-item">Generator: <span>{result.model}</span></div>
                    </motion.div>
                  )}
                </section>

                {/* Answer Card */}
                {result && (
                  <motion.section 
                    className="answer-section glass-card"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <div className="card-title">
                      <MessageSquare size={16} className="icon-mr" /> Synthesized Response
                    </div>

                    <div className={`answer-text ${!result.grounded ? 'refused' : ''}`}>
                      {result.answer}
                    </div>

                    {result.grounded && result.sources?.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        transition={{ delay: 0.6 }}
                      >
                        <div className="card-title" style={{ marginTop: 24 }}>
                          <FileText size={16} className="icon-mr" /> Retrieved Context
                        </div>
                        <div className="sources-list">
                          {result.sources.map((src, i) => (
                            <motion.div 
                              className="source-item" 
                              key={i}
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.7 + i * 0.1 }}
                            >
                              <div className="source-head">
                                <span className="source-rank">Reference {src.rank} — {src.passage_id}</span>
                                <span className="source-score">Relevance: {src.score}</span>
                              </div>
                              <div className="source-text">{src.text}...</div>
                              {src.strategies?.length > 0 && (
                                <div className="source-strategies">
                                  {src.strategies.map((s, idx) => (
                                    <span className="strategy-tag" key={`${s}-${idx}`}>{s}</span>
                                  ))}
                                </div>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      </motion.div>
                    )}

                    <div className="confidence-section">
                      <div className="confidence-label">
                        <span>Grounding Confidence</span>
                        <span style={{ color: confColor }}>{confidence}%</span>
                      </div>
                      <div className="confidence-bar">
                        <motion.div 
                          className="confidence-fill" 
                          initial={{ width: 0 }}
                          animate={{ width: `${confidence}%` }}
                          transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
                          style={{ background: confColor }}
                        />
                      </div>
                    </div>

                    <div className="guardrail-badges">
                      {result.guardrails?.input?.checks?.map((c, i) => (
                        <span key={i} className={`guardrail-badge ${c.passed ? 'pass' : c.name.includes('warning') ? 'warn' : 'fail'}`}>
                          {c.passed ? <CheckCircle2 size={12}/> : <span>✕</span>} {c.name.replace(/_/g, ' ')}
                        </span>
                      ))}
                      {result.guardrails?.output?.checks?.map((c, i) => (
                        <span key={`o${i}`} className={`guardrail-badge ${c.passed ? 'pass' : 'fail'}`}>
                          {c.passed ? <CheckCircle2 size={12}/> : <span>✕</span>} {c.name.replace(/_/g, ' ')}
                        </span>
                      ))}
                      {result.grounded && (
                        <span className="guardrail-badge pass"><CheckCircle2 size={12}/> Grounded</span>
                      )}
                    </div>
                  </motion.section>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="empty-state glass-card"
              >
                <Search size={48} className="empty-icon" />
                <h3>Ready to retrieve</h3>
                <p>Speak or type a query to execute the RAG pipeline.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
