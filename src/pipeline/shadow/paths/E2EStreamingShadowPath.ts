/**
 * E2EStreamingShadowPath (#730) — drives a continuous E2E streaming session
 * (CloudRealtimeE2E → gpt-realtime-translate) segment by segment so it can be
 * measured against the batch cascade.
 *
 * Two properties make the numbers mean anything (design verified with Codex):
 *
 * 1. ONE long-lived session across all segments, warmed up before measurement.
 *    A fresh WebSocket per segment would fold the handshake into every
 *    first-subtitle number and reflect nothing about production, where a single
 *    session spans the whole meeting.
 *
 * 2. Audio is pushed at realtime cadence. Blasting a pre-recorded utterance at
 *    disk speed distorts server-side VAD, interim emission timing and
 *    backpressure — the path would look faster than a live speaker ever gets.
 *
 * Billing is per audio minute, so realtime pacing costs no more than a burst.
 */

import type { E2EStreamingSession, E2ETranslationEngine, TranslationResult } from '../../../engines/types'
import type { PathSampleResult, ShadowCostModel, ShadowPath, ShadowPathKind } from '../types'

/** Chunk size of the production realtime capture adapter (#721). */
const DEFAULT_CHUNK_MS = 100
/**
 * Quiet period after the last audio chunk before we force a segment boundary.
 * The translation endpoint exposes no turn-commit, so a segment is committed
 * either by the server's own done event or by this settle timer — flushing the
 * instant the audio ends would truncate translations still in flight.
 */
const DEFAULT_SETTLE_MS = 800
/**
 * Trailing silence appended to each segment. A live speaker's pause is what makes
 * the server close a turn; a pre-recorded clip that stops dead gives it no cue.
 */
const DEFAULT_TRAILING_SILENCE_MS = 500
/** Hard cap per segment so one stuck turn cannot wedge the run. */
const DEFAULT_SEGMENT_TIMEOUT_MS = 30_000

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface E2EStreamingShadowPathOptions {
  id?: string
  /** Must implement createStreamingSession(). */
  engine: E2ETranslationEngine
  cost?: ShadowCostModel
  usesLocalLlm?: boolean
  chunkMs?: number
  settleMs?: number
  trailingSilenceMs?: number
  segmentTimeoutMs?: number
  /** Disable realtime pacing (tests only — distorts live measurements). */
  realtimePacing?: boolean
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>
}

interface PendingSegment {
  seq: number
  startedAt: number
  firstSubtitleMs: number | null
  revisionCount: number
  latest: TranslationResult | null
  promise: Promise<PathSampleResult>
  resolve: (result: PathSampleResult) => void
  reject: (err: Error) => void
  settled: boolean
  /** Bumped by every interim; the settle timer only fires once deltas go quiet. */
  lastActivityAt: number
}

export class E2EStreamingShadowPath implements ShadowPath {
  readonly id: string
  readonly kind: ShadowPathKind = 'e2e-streaming'
  readonly usesLocalLlm: boolean
  readonly isOffline: boolean
  readonly cost: ShadowCostModel

  private readonly engine: E2ETranslationEngine
  private readonly chunkMs: number
  private readonly settleMs: number
  private readonly trailingSilenceMs: number
  private readonly segmentTimeoutMs: number
  private readonly realtimePacing: boolean
  private readonly sleep: (ms: number) => Promise<void>

  private session: E2EStreamingSession | null = null
  private sessionAbort: AbortController | null = null
  private pending: PendingSegment | null = null
  private seq = 0

  constructor(options: E2EStreamingShadowPathOptions) {
    if (!options.engine.createStreamingSession) {
      throw new Error(`Engine ${options.engine.id} does not support streaming sessions`)
    }
    this.id = options.id ?? `e2e-streaming:${options.engine.id}`
    this.engine = options.engine
    this.isOffline = options.engine.isOffline
    this.usesLocalLlm = options.usesLocalLlm ?? false
    this.cost = options.cost ?? {}
    this.chunkMs = options.chunkMs ?? DEFAULT_CHUNK_MS
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS
    this.trailingSilenceMs = options.trailingSilenceMs ?? DEFAULT_TRAILING_SILENCE_MS
    this.segmentTimeoutMs = options.segmentTimeoutMs ?? DEFAULT_SEGMENT_TIMEOUT_MS
    this.realtimePacing = options.realtimePacing ?? true
    this.sleep = options.sleep ?? realSleep
  }

  /**
   * Open and warm the session up front. Optional but recommended: without it the
   * first measured segment carries the connection handshake and shows up as a
   * first-sample artifact in the report.
   */
  async warmup(): Promise<void> {
    await this.ensureSession()
  }

  async process(
    audio: Float32Array,
    sampleRate: number,
    signal: AbortSignal
  ): Promise<PathSampleResult> {
    signal.throwIfAborted()
    // The runner enforces one in-flight segment per path (permits=1), but the
    // "next final resolves the pending segment" correlation silently breaks if
    // that ever changes — so assert it here rather than trusting the caller.
    if (this.pending) {
      throw new Error(`${this.id} does not support concurrent segments`)
    }

    const session = await this.ensureSession()
    signal.throwIfAborted()

    const pending = this.createPending()
    try {
      await this.pushPaced(session, audio, sampleRate, signal)
      return await this.awaitSegment(session, pending, signal)
    } finally {
      this.clearPending(pending.seq)
    }
  }

  /** Release the pending slot, but only if it is still the segment we started. */
  private clearPending(seq: number): void {
    if (this.pending && this.pending.seq === seq) this.pending = null
  }

  /** Tear the session down. Safe to call repeatedly. */
  async dispose(): Promise<void> {
    this.failPending(new Error('Session disposed'))
    const session = this.session
    this.session = null
    this.sessionAbort?.abort()
    this.sessionAbort = null
    // Never flush on teardown: a trailing line here belongs to no segment.
    if (session) await session.stop({ flush: false }).catch(() => undefined)
  }

  // --- internals ---

  private async ensureSession(): Promise<E2EStreamingSession> {
    if (this.session) return this.session
    const session = this.engine.createStreamingSession!()
    const abort = new AbortController()
    this.sessionAbort = abort
    await session.start({ signal: abort.signal, sink: this.buildSink() })
    this.session = session
    return session
  }

  private buildSink(): { interim: (r: TranslationResult) => void; final: (r: TranslationResult) => void; error: (e: Error) => void } {
    return {
      interim: (result) => {
        const pending = this.pending
        if (!pending || pending.settled) return
        pending.revisionCount++
        pending.latest = result
        pending.lastActivityAt = performance.now()
        pending.firstSubtitleMs ??= pending.lastActivityAt - pending.startedAt
      },
      final: (result) => {
        const pending = this.pending
        if (!pending || pending.settled) return
        pending.latest = result
        this.settle(pending, result)
      },
      error: (err) => this.failPending(err)
    }
  }

  private createPending(): PendingSegment {
    const now = performance.now()
    let resolve!: (result: PathSampleResult) => void
    let reject!: (err: Error) => void
    const promise = new Promise<PathSampleResult>((res, rej) => {
      resolve = res
      reject = rej
    })
    const pending: PendingSegment = {
      seq: ++this.seq,
      startedAt: now,
      firstSubtitleMs: null,
      revisionCount: 0,
      latest: null,
      promise,
      resolve,
      reject,
      settled: false,
      lastActivityAt: now
    }
    // A rejection is surfaced by awaitSegment; this keeps a reject that lands
    // before anyone awaits from becoming an unhandled rejection.
    promise.catch(() => undefined)
    this.pending = pending
    return pending
  }

  private settle(pending: PendingSegment, result: TranslationResult): void {
    if (pending.settled) return
    pending.settled = true
    pending.resolve({
      sourceText: result.sourceText,
      translatedText: result.translatedText,
      firstSubtitleMs: pending.firstSubtitleMs,
      // A final that arrived with no preceding interim is still one subtitle.
      revisionCount: pending.revisionCount
    })
  }

  private failPending(err: Error): void {
    const pending = this.pending
    if (!pending || pending.settled) return
    pending.settled = true
    this.pending = null
    pending.reject(err)
  }

  /** Push audio at (optionally) realtime cadence, honoring backpressure and abort. */
  private async pushPaced(
    session: E2EStreamingSession,
    audio: Float32Array,
    sampleRate: number,
    signal: AbortSignal
  ): Promise<void> {
    const frame = Math.max(1, Math.round((this.chunkMs / 1000) * sampleRate))
    for (let offset = 0; offset < audio.length; offset += frame) {
      signal.throwIfAborted()
      const chunk = audio.subarray(offset, Math.min(offset + frame, audio.length))
      const backpressure = await session.pushAudio(chunk)
      if (backpressure) await backpressure.drained
      if (this.realtimePacing) await this.sleep((chunk.length / sampleRate) * 1000)
    }

    if (this.trailingSilenceMs > 0) {
      const silence = new Float32Array(Math.round((this.trailingSilenceMs / 1000) * sampleRate))
      signal.throwIfAborted()
      await session.pushAudio(silence)
      if (this.realtimePacing) await this.sleep(this.trailingSilenceMs)
    }
  }

  /**
   * Resolve the segment on whichever comes first: the server's own final, a
   * quiet period (we then force the boundary via flushSegment), or the timeout.
   */
  private async awaitSegment(
    session: E2EStreamingSession,
    pending: PendingSegment,
    signal: AbortSignal
  ): Promise<PathSampleResult> {
    const deadline = performance.now() + this.segmentTimeoutMs
    const onAbort = (): void => this.failPending(new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      while (!pending.settled) {
        if (performance.now() > deadline) {
          // A stuck turn poisons the session's accumulator for every later
          // segment, so drop the connection instead of carrying it forward.
          await this.dispose()
          throw new Error(`Segment timed out after ${this.segmentTimeoutMs}ms`)
        }
        const quietFor = performance.now() - pending.lastActivityAt
        if (quietFor >= this.settleMs) {
          // flushSegment() commits whatever the session accumulated, which lands
          // in sink.final and settles `promise` below.
          await session.flushSegment?.()
          if (!pending.settled) {
            // Nothing accumulated at all: the server never produced text for this
            // segment (silence, or a turn it declined to translate).
            this.settleEmpty(pending)
          }
          break
        }
        await Promise.race([
          pending.promise.catch(() => undefined),
          this.sleep(Math.min(this.settleMs - quietFor, this.settleMs))
        ])
      }
      return await pending.promise
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private settleEmpty(pending: PendingSegment): void {
    if (pending.settled) return
    pending.settled = true
    pending.resolve({
      sourceText: pending.latest?.sourceText ?? '',
      translatedText: '',
      firstSubtitleMs: pending.firstSubtitleMs,
      revisionCount: pending.revisionCount
    })
  }
}
