import type { EventEmitter } from 'events'
import type { E2EStreamingSink, TranslationResult } from '../engines/types'

/**
 * Bridges an E2E streaming session's sink output onto the pipeline's existing
 * EventEmitter contract ('interim-result' / 'result' / 'error'), so downstream
 * consumers (SubtitleOverlay / SessionManager) need no changes.
 *
 * Emissions are gated by two conditions: the owning session's AbortSignal, and a
 * generation predicate supplied by the pipeline. Once the session is aborted or
 * the pipeline generation advances (engine switch), results are dropped — stale
 * cross-session output is never forwarded.
 */
export class E2EStreamingAdapter implements E2EStreamingSink {
  constructor(
    private readonly emitter: EventEmitter,
    private readonly signal: AbortSignal,
    private readonly isCurrentGeneration: () => boolean
  ) {}

  private get active(): boolean {
    return !this.signal.aborted && this.isCurrentGeneration()
  }

  interim(result: TranslationResult): void {
    if (!this.active) return
    this.emitter.emit('interim-result', { ...result, isInterim: true })
  }

  final(result: TranslationResult): void {
    if (!this.active) return
    this.emitter.emit('result', { ...result, isInterim: false })
  }

  error(error: Error): void {
    if (!this.active) return
    this.emitter.emit('error', error)
  }
}
