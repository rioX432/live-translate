/** Supported language pair direction */
export type Direction = 'ja-en' | 'en-ja'

/** A single test sentence from the JSONL testset */
export interface TestSentence {
  id: string
  source: string
  reference: string
  direction: Direction
  domain: 'casual' | 'business' | 'technical'
  length: 'short' | 'medium' | 'long'
}

/** Memory snapshot at a point in time */
export interface MemorySnapshot {
  heapUsedMB: number
  rssMB: number
  externalMB: number
  timestamp: number
}

/** Result of translating a single sentence */
export interface SentenceResult {
  id: string
  source: string
  reference: string
  output: string
  direction: Direction
  domain: string
  length: string
  latencyMs: number
  error?: string
}

/** Latency statistics for a set of translations */
export interface LatencyStats {
  avg: number
  median: number
  p95: number
  min: number
  max: number
}

/** Summary for one engine run */
export interface EngineSummary {
  engineId: string
  engineLabel: string
  direction: Direction
  totalSentences: number
  errors: number
  latency: LatencyStats
  peakRssMB: number
  results: SentenceResult[]
}

/** Full benchmark result */
export interface BenchmarkResult {
  timestamp: string
  summaries: EngineSummary[]
}

/**
 * Benchmark engine interface.
 * Lightweight, Electron-independent alternative to TranslatorEngine.
 */
export interface BenchmarkEngine {
  readonly id: string
  readonly label: string

  /** Initialize model/connection. Must be idempotent. */
  initialize(): Promise<void>

  /** Translate a single text. */
  translate(text: string, direction: Direction): Promise<string>

  /** Release resources. Safe to call even if not initialized. */
  dispose(): Promise<void>
}
