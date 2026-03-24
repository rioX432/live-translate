/** A single test entry from the STT manifest JSONL */
export interface STTTestEntry {
  id: string
  audio_path: string
  reference_text: string
  language: 'ja' | 'en'
  domain: 'casual' | 'business' | 'technical'
}

/** STT benchmark engine interface — Electron-independent */
export interface STTBenchmarkEngine {
  readonly id: string
  readonly label: string

  /** Initialize model/connection. Must be idempotent. */
  initialize(): Promise<void>

  /** Transcribe a WAV file and return the recognized text. */
  transcribe(audioPath: string, language?: string): Promise<string>

  /** Release resources. Safe to call even if not initialized. */
  dispose(): Promise<void>
}

/** Result of transcribing a single audio file */
export interface STTSentenceResult {
  id: string
  audioPath: string
  reference: string
  output: string
  language: string
  domain: string
  latencyMs: number
  error?: string
}

/** WER breakdown */
export interface WERResult {
  wer: number
  substitutions: number
  insertions: number
  deletions: number
  referenceLength: number
}

/** Latency statistics */
export interface STTLatencyStats {
  avg: number
  median: number
  p95: number
  min: number
  max: number
}

/** Summary for one STT engine run */
export interface STTEngineSummary {
  engineId: string
  engineLabel: string
  totalFiles: number
  errors: number
  latency: STTLatencyStats
  wer: WERResult
  werByLanguage: Record<string, WERResult>
  peakRssMB: number
  results: STTSentenceResult[]
}

/** Full STT benchmark result */
export interface STTBenchmarkResult {
  timestamp: string
  summaries: STTEngineSummary[]
}
