/**
 * Types for the shadow measurement harness (#720).
 *
 * The ShadowRunner feeds identical audio to multiple engine paths in parallel
 * purely for telemetry. It is fully decoupled from the production pipeline and
 * emits nothing to the UI or session — only measurement records.
 */

/** How a shadow path turns audio into a translation. */
export type ShadowPathKind = 'cascade' | 'e2e' | 'e2e-streaming'

/**
 * Cost model for a path (BYOK metered). Offline paths have zero marginal cost;
 * cloud paths are billed per source character.
 */
export interface ShadowCostModel {
  /** USD per 1,000,000 source characters. 0 for fully offline paths. */
  usdPerMillionChars: number
}

/** Static description of a measurable path. */
export interface ShadowPathDescriptor {
  readonly id: string
  readonly kind: ShadowPathKind
  /**
   * True if this path routes through the shared node-llama-cpp UtilityProcess
   * pool. Such paths contend for a single worker, so they are gated by a global
   * local-LLM semaphore and default to disabled / low-frequency sampling.
   */
  readonly usesLocalLlm: boolean
  /** True if the path completes entirely offline (privacy: offline completeness). */
  readonly isOffline: boolean
  /** Cost model for BYOK metering. */
  readonly cost: ShadowCostModel
}

/** Result of processing one audio segment through a path. */
export interface PathSampleResult {
  /** Recognized source text (may be empty for silence/no-speech). */
  sourceText: string
  /** Translated text. */
  translatedText: string
  /**
   * Time from audio submission to the first interim subtitle output (ms), or
   * null if the path produced no interim result before its final one.
   */
  firstSubtitleMs: number | null
  /**
   * Number of interim revisions before the final result. This is a STABILITY
   * proxy, not a translation-quality signal — a path can be stable and wrong,
   * or revise often yet end up more accurate.
   */
  revisionCount: number
}

/**
 * A measurable engine path. Engine-agnostic so it can be unit-tested with mocks
 * and wired to real cascade / e2e / e2e-streaming engines without changing the
 * runner.
 */
export interface ShadowPath extends ShadowPathDescriptor {
  /**
   * Process one audio segment and return its result. Implementations must:
   * - honor `signal` (reject or return promptly once aborted), and
   * - treat `audio` as read-only (never mutate it).
   */
  process(audio: Float32Array, sampleRate: number, signal: AbortSignal): Promise<PathSampleResult>
}

/** Per-path activation and sampling policy. */
export interface ShadowPathConfig {
  /** Whether the path participates in measurement. Local-LLM paths default false. */
  enabled: boolean
  /**
   * Process 1 of every N submitted segments (>= 1). 1 measures every segment;
   * higher values thin out local-LLM paths to avoid pool contention.
   */
  samplingInterval: number
  /** Concurrent permits for this path (default 1 — engines are sequential). */
  permits: number
}

export const DEFAULT_PATH_CONFIG: ShadowPathConfig = {
  enabled: true,
  samplingInterval: 1,
  permits: 1
}

/** Local-LLM paths are expensive and share one worker, so they start off. */
export const DEFAULT_LOCAL_LLM_PATH_CONFIG: ShadowPathConfig = {
  enabled: false,
  samplingInterval: 8,
  permits: 1
}

export interface ShadowRunnerConfig {
  /** Max records retained per category (samples / drops / errors). Bounded to cap memory. */
  maxRecords: number
  /** Permits shared by ALL local-LLM paths so only one runs at a time. */
  localLlmPermits: number
  /**
   * Max time stop() waits for in-flight tasks to drain (ms). Paths are required
   * to honor their AbortSignal, but local-LLM inference generally cannot be
   * cancelled mid-generation, so stop() must not hang on a stuck path. Results
   * arriving after the timeout are discarded by the generation guard.
   */
  stopDrainTimeoutMs: number
}

export const DEFAULT_RUNNER_CONFIG: ShadowRunnerConfig = {
  maxRecords: 2000,
  localLlmPermits: 1,
  stopDrainTimeoutMs: 5000
}

/** Reason a segment was not measured on a given path. */
export type DropReason = 'disabled' | 'sampling' | 'path-busy' | 'local-llm-busy' | 'not-running'

/** A recorded telemetry sample for one processed segment on one path. */
export interface ShadowSample {
  pathId: string
  segmentId: number
  timestamp: number
  /** End-to-end wall-clock latency for the path (ms). */
  latencyMs: number
  /** First-subtitle latency (ms) or null when the path emits no interim. */
  firstSubtitleMs: number | null
  /** Interim revision count (stability proxy). */
  revisionCount: number
  /** Source character count (drives cost metering). */
  sourceChars: number
  /** Estimated marginal cost for this sample in USD. */
  costUsd: number
  /** Whether the path stayed fully offline for this sample (privacy). */
  isOffline: boolean
}

/** A recorded drop (segment not measured on a path). */
export interface ShadowDrop {
  pathId: string
  segmentId: number
  timestamp: number
  reason: DropReason
}

/** A recorded processing error on a path. */
export interface ShadowError {
  pathId: string
  segmentId: number
  timestamp: number
  message: string
}
