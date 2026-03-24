/** Language code for STT benchmark */
export type STTLanguage = 'ja' | 'en'

/** Domain category for test audio */
export type STTDomain = 'casual' | 'business' | 'technical'

/** A single entry from the STT test manifest */
export interface STTTestEntry {
  id: string
  audio_path: string
  reference_text: string
  language: STTLanguage
  domain: STTDomain
}

/** Result of transcribing a single audio file */
export interface STTSentenceResult {
  id: string
  reference: string
  hypothesis: string
  language: STTLanguage
  domain: STTDomain
  latencyMs: number
  error?: string
}

/** WER/CER statistics for a set of results */
export interface AccuracyStats {
  /** Word Error Rate (for EN) or Character Error Rate (for JA) */
  errorRate: number
  /** Number of substitutions */
  substitutions: number
  /** Number of deletions */
  deletions: number
  /** Number of insertions */
  insertions: number
  /** Total reference tokens */
  totalReferenceTokens: number
}

/** Summary for one STT engine run */
export interface STTEngineSummary {
  engineId: string
  engineLabel: string
  language: STTLanguage | 'all'
  totalFiles: number
  errors: number
  accuracy: AccuracyStats
  latency: import('./types.js').LatencyStats
  peakRssMB: number
  results: STTSentenceResult[]
}

/** Full STT benchmark result */
export interface STTBenchmarkResult {
  timestamp: string
  summaries: STTEngineSummary[]
}

/**
 * Benchmark engine interface for STT.
 * Each engine must transcribe a WAV file and return text.
 */
export interface STTBenchmarkEngine {
  readonly id: string
  readonly label: string

  /** Initialize model/connection. Must be idempotent. */
  initialize(): Promise<void>

  /** Transcribe a single WAV audio file. Returns recognized text. */
  transcribe(audioPath: string): Promise<{ text: string; language?: string }>

  /** Release resources. Safe to call even if not initialized. */
  dispose(): Promise<void>
}
