/**
 * Lifecycle of one speech segment (one VAD utterance), keyed by the segment id
 * the audio source assigns.
 *
 *   open ──interim──▶ open ──final submitted──▶ finalizing ──▶ finalized
 *
 * A segment is finalized exactly once: a second final for the same id is
 * rejected, and interim output is accepted only while the segment is open, so
 * a late interim can never replace the final subtitle.
 */
export type SegmentPhase = 'open' | 'finalizing' | 'finalized'

/** Ids are remembered long enough to reject stragglers; older ones are dropped. */
const MAX_TRACKED_SEGMENTS = 64

export class SegmentTracker {
  private phases = new Map<string, SegmentPhase>()

  phase(segmentId: string): SegmentPhase | undefined {
    return this.phases.get(segmentId)
  }

  /** Record interim activity. Returns false when the segment is already closing or closed. */
  touchInterim(segmentId: string): boolean {
    const phase = this.phases.get(segmentId)
    if (phase === undefined) {
      this.set(segmentId, 'open')
      return true
    }
    return phase === 'open'
  }

  /** Whether interim output for this segment may still be shown. */
  mayEmitInterim(segmentId: string): boolean {
    return this.phases.get(segmentId) === 'open'
  }

  /** Claim the final for this segment. Returns false if it was already claimed. */
  beginFinalize(segmentId: string): boolean {
    const phase = this.phases.get(segmentId)
    if (phase === 'finalizing' || phase === 'finalized') return false
    this.set(segmentId, 'finalizing')
    return true
  }

  markFinalized(segmentId: string): void {
    this.set(segmentId, 'finalized')
  }

  reset(): void {
    this.phases.clear()
  }

  private set(segmentId: string, phase: SegmentPhase): void {
    // Re-insert so Map iteration order tracks recency for eviction.
    this.phases.delete(segmentId)
    this.phases.set(segmentId, phase)
    while (this.phases.size > MAX_TRACKED_SEGMENTS) {
      const oldest = this.phases.keys().next().value
      if (oldest === undefined) break
      this.phases.delete(oldest)
    }
  }
}
