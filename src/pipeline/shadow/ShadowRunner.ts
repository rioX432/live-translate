/**
 * ShadowRunner — parallel engine-path measurement harness (#720).
 *
 * Feeds identical audio to multiple engine paths in parallel and records
 * multivariate telemetry (latency / cost / privacy / stability). It is fully
 * SEPARATED from the production pipeline:
 * - it never touches EngineManager's single active engine,
 * - it emits nothing to the UI or session (telemetry only), and
 * - it is fed audio through an explicit tap ({@link submit}), so the production
 *   audio IPC path (which is deduplicated) is never entangled.
 *
 * Design (verified with Codex):
 * - Per-path "drop-if-busy" semaphore: when a path is still processing, new
 *   audio is DROPPED, not queued. Queuing would fold wait time into measured
 *   latency and corrupt the numbers.
 * - Local-LLM paths share ONE global semaphore so at most one runs at a time —
 *   they contend for a single node-llama-cpp UtilityProcess worker, so
 *   overlapping them would measure pool contention instead of path behavior.
 *   They also default to disabled / low-frequency sampling.
 * - Cancellation: an AbortController plus a monotonic generation counter. A
 *   task that resolves after stop() (or a subsequent start()) is discarded, not
 *   recorded, so stale cross-run results never leak into telemetry.
 * - Bounded record buffers cap memory during long sessions.
 */

import { Semaphore } from './Semaphore'
import { estimateCostUsd, summarize } from './metrics'
import type { ShadowReport } from './metrics'
import {
  DEFAULT_PATH_CONFIG,
  DEFAULT_LOCAL_LLM_PATH_CONFIG,
  DEFAULT_RUNNER_CONFIG
} from './types'
import type {
  ShadowPath,
  ShadowPathConfig,
  ShadowPathDescriptor,
  ShadowRunnerConfig,
  ShadowSample,
  ShadowDrop,
  ShadowError,
  DropReason
} from './types'

interface RegisteredPath {
  path: ShadowPath
  config: ShadowPathConfig
  semaphore: Semaphore
  /** Submit counter used to implement 1-in-N sampling. */
  submitCount: number
}

export class ShadowRunner {
  private readonly config: ShadowRunnerConfig
  private readonly paths = new Map<string, RegisteredPath>()
  private readonly localLlmSemaphore: Semaphore

  private samples: ShadowSample[] = []
  private drops: ShadowDrop[] = []
  private errors: ShadowError[] = []

  private running = false
  private generation = 0
  private abort: AbortController | null = null
  private nextSegmentId = 0
  /** Segments submitted since the last clearTelemetry(), matching the record window. */
  private submittedSegments = 0
  private inFlight = new Set<Promise<void>>()
  private stopPromise: Promise<void> | null = null

  constructor(config: Partial<ShadowRunnerConfig> = {}) {
    this.config = { ...DEFAULT_RUNNER_CONFIG, ...config }
    this.localLlmSemaphore = new Semaphore(this.config.localLlmPermits)
  }

  /**
   * Register a measurable path. Local-LLM paths default to disabled with
   * low-frequency sampling unless an explicit override is supplied.
   */
  register(path: ShadowPath, configOverride: Partial<ShadowPathConfig> = {}): void {
    const base = path.usesLocalLlm ? DEFAULT_LOCAL_LLM_PATH_CONFIG : DEFAULT_PATH_CONFIG
    const config: ShadowPathConfig = { ...base, ...configOverride }
    if (config.samplingInterval < 1) config.samplingInterval = 1
    if (config.permits < 1) config.permits = 1
    this.paths.set(path.id, {
      path,
      config,
      semaphore: new Semaphore(config.permits),
      submitCount: 0
    })
  }

  /** Descriptors of all registered paths (for reporting on zero-sample paths). */
  get descriptors(): ShadowPathDescriptor[] {
    return [...this.paths.values()].map((r) => r.path)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Begin a measurement run. Resets per-run cancellation state. */
  start(): void {
    if (this.running) return
    this.running = true
    this.generation++
    this.abort = new AbortController()
  }

  /**
   * Abort the current run. In-flight path tasks are cancelled and their results
   * discarded. Waits for outstanding tasks to drain, bounded by
   * stopDrainTimeoutMs — a path that ignores its AbortSignal (local-LLM
   * inference cannot be cancelled mid-generation) must not hang shutdown.
   * Concurrent stop() calls share the same drain.
   */
  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    if (!this.running) return
    this.running = false
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.stopPromise = this.drainWithTimeout().finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  private async drainWithTimeout(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.config.stopDrainTimeoutMs)
    })
    try {
      await Promise.race([this.whenIdle(), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Resolve once all in-flight path tasks have settled. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight])
    }
  }

  /**
   * Fan a single audio segment out to every enabled path. Returns the segment
   * id, or -1 when the runner is not running. The audio is copied once up front
   * so paths observe identical, immutable sample data even if the caller reuses
   * its buffer.
   */
  submit(audio: Float32Array, sampleRate: number): number {
    if (!this.running || !this.abort) return -1

    const segmentId = this.nextSegmentId++
    this.submittedSegments++
    const generation = this.generation
    const signal = this.abort.signal
    // Copy once, share the immutable snapshot across all paths.
    const snapshot = Float32Array.from(audio)

    for (const registered of this.paths.values()) {
      this.dispatch(registered, snapshot, sampleRate, segmentId, generation, signal)
    }
    return segmentId
  }

  private dispatch(
    registered: RegisteredPath,
    audio: Float32Array,
    sampleRate: number,
    segmentId: number,
    generation: number,
    signal: AbortSignal
  ): void {
    const { path, config, semaphore } = registered

    if (!config.enabled) {
      this.recordDrop(path.id, segmentId, 'disabled')
      return
    }

    // 1-in-N sampling: measure the first submit and every Nth thereafter.
    const measure = registered.submitCount % config.samplingInterval === 0
    registered.submitCount++
    if (!measure) {
      this.recordDrop(path.id, segmentId, 'sampling')
      return
    }

    // Drop-if-busy on the per-path semaphore.
    if (!semaphore.tryAcquire()) {
      this.recordDrop(path.id, segmentId, 'path-busy')
      return
    }

    // Local-LLM paths additionally share one global permit.
    const usesGlobal = path.usesLocalLlm
    if (usesGlobal && !this.localLlmSemaphore.tryAcquire()) {
      semaphore.release()
      this.recordDrop(path.id, segmentId, 'local-llm-busy')
      return
    }

    const task = this.runPath(path, audio, sampleRate, segmentId, generation, signal)
      .finally(() => {
        semaphore.release()
        if (usesGlobal) this.localLlmSemaphore.release()
      })
    const tracked = task.finally(() => {
      this.inFlight.delete(tracked)
    })
    this.inFlight.add(tracked)
  }

  private async runPath(
    path: ShadowPath,
    audio: Float32Array,
    sampleRate: number,
    segmentId: number,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    const start = performance.now()
    try {
      const result = await path.process(audio, sampleRate, signal)
      const latencyMs = performance.now() - start

      // Discard results that outlived their run: aborted, superseded by a newer
      // generation, or arriving after stop().
      if (signal.aborted || generation !== this.generation || !this.running) return

      const sourceChars = result.sourceText.length
      this.recordSample({
        pathId: path.id,
        segmentId,
        timestamp: Date.now(),
        latencyMs,
        firstSubtitleMs: result.firstSubtitleMs,
        revisionCount: result.revisionCount,
        sourceChars,
        costUsd: estimateCostUsd(sourceChars, path.cost.usdPerMillionChars),
        isOffline: path.isOffline
      })
    } catch (err) {
      if (signal.aborted || generation !== this.generation || !this.running) return
      this.recordError(path.id, segmentId, err instanceof Error ? err.message : String(err))
    }
  }

  private recordSample(sample: ShadowSample): void {
    this.samples.push(sample)
    if (this.samples.length > this.config.maxRecords) this.samples.shift()
  }

  private recordDrop(pathId: string, segmentId: number, reason: DropReason): void {
    this.drops.push({ pathId, segmentId, timestamp: Date.now(), reason })
    if (this.drops.length > this.config.maxRecords) this.drops.shift()
  }

  private recordError(pathId: string, segmentId: number, message: string): void {
    this.errors.push({ pathId, segmentId, timestamp: Date.now(), message })
    if (this.errors.length > this.config.maxRecords) this.errors.shift()
  }

  getSamples(): readonly ShadowSample[] {
    return this.samples
  }

  getDrops(): readonly ShadowDrop[] {
    return this.drops
  }

  getErrors(): readonly ShadowError[] {
    return this.errors
  }

  /** Build the multivariate telemetry report from recorded samples/drops/errors. */
  getReport(): ShadowReport {
    return summarize(this.descriptors, this.samples, this.drops, this.errors, this.submittedSegments)
  }

  /** Clear all recorded telemetry (keeps registrations and run state). */
  clearTelemetry(): void {
    this.samples = []
    this.drops = []
    this.errors = []
    this.submittedSegments = 0
  }
}
