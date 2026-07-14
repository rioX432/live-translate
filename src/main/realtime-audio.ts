import { createLogger } from './logger'
import type { AppContext } from './app-context'

const log = createLogger('realtime-audio')

/**
 * Upper bound on in-flight realtime chunks (~5s at 100ms). Cloud realtime APIs
 * expect a continuous stream, but if the session stalls we must not let the
 * queue (and its captured PCM buffers) grow without limit — new chunks are
 * dropped past this bound rather than accumulating unbounded latency/memory.
 */
const MAX_PENDING_CHUNKS = 50

/**
 * Serializes realtime (cloud e2e) audio pushes and turn-boundary signals onto a
 * single ordered promise chain (#721).
 *
 * Why a shared chain:
 * - Ordering: audio may arrive via the MessagePort transport while the
 *   turn-boundary hint arrives via IPC. Routing both through one chain keeps
 *   `onSpeechBoundary()` sequenced after the audio it follows, so a segment is
 *   never flushed before its trailing chunks reach the session.
 * - Backpressure: each push awaits the session's `drained` signal internally;
 *   the bounded `pending` counter caps how far the producer can run ahead.
 * - Session isolation: `epoch` invalidates any chunks still queued from a prior
 *   session, so stale audio can never bleed into a freshly started session.
 */
export class RealtimeAudioDispatcher {
  private chain: Promise<void> = Promise.resolve()
  private pending = 0
  private epoch = 0
  private dropped = 0

  constructor(private readonly maxPending: number = MAX_PENDING_CHUNKS) {}

  /** Queue a realtime PCM chunk for the active e2e session. */
  pushAudio(ctx: AppContext, chunk: Float32Array): void {
    if (!ctx.pipeline?.running || chunk.length === 0) return

    if (this.pending >= this.maxPending) {
      this.dropped++
      // Log the first drop and then periodically to avoid flooding.
      if (this.dropped === 1 || this.dropped % this.maxPending === 0) {
        log.warn(`Realtime backlog saturated (${this.pending} pending); dropping chunk (total dropped: ${this.dropped})`)
      }
      return
    }

    const epoch = this.epoch
    this.pending++
    this.chain = this.chain
      .then(() => {
        // Drop work belonging to a superseded session.
        if (epoch !== this.epoch || !ctx.pipeline?.running) return
        return ctx.pipeline.pushRealtimeAudio(chunk)
      })
      .catch((err) => log.error('Realtime audio push error:', err))
      .finally(() => { this.pending = Math.max(0, this.pending - 1) })
  }

  /** Queue a turn-boundary hint; only 'end' finalizes the current segment. */
  signalBoundary(ctx: AppContext, boundary: unknown): void {
    if (boundary !== 'end' || !ctx.pipeline?.running) return

    const epoch = this.epoch
    this.chain = this.chain
      .then(() => {
        if (epoch !== this.epoch || !ctx.pipeline?.running) return
        return ctx.pipeline.onSpeechBoundary()
      })
      .catch((err) => log.error('Speech boundary error:', err))
  }

  /**
   * Start a new session generation: detaches the current chain and invalidates
   * any queued chunks. Call on pipeline start and stop.
   */
  reset(): void {
    this.epoch++
    this.chain = Promise.resolve()
    this.pending = 0
    this.dropped = 0
  }
}

let dispatcher: RealtimeAudioDispatcher | null = null

/** Shared dispatcher instance used by every realtime audio transport. */
export function getRealtimeAudioDispatcher(): RealtimeAudioDispatcher {
  if (!dispatcher) dispatcher = new RealtimeAudioDispatcher()
  return dispatcher
}

/** Invalidate queued realtime work on session start/stop. */
export function resetRealtimeAudioDispatcher(): void {
  dispatcher?.reset()
}
