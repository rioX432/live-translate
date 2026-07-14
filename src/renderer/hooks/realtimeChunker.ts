/**
 * Repackages a stream of variable-length PCM frames into fixed-size chunks.
 *
 * Cloud realtime translation APIs (OpenAI realtime, Gemini Live) expect audio
 * appended as fixed ~100ms PCM chunks, but the VAD emits frames of a different
 * cadence (~96ms at 16kHz). This buffers incoming frames and emits exactly
 * `chunkSamples`-long chunks, carrying the remainder to the next push so no
 * sample is dropped or duplicated. Chunk boundaries are driven purely by sample
 * count, never by a timer, to keep the stream continuous and gap-free.
 */
export class RealtimeChunker {
  private pending: Float32Array[] = []
  private pendingLength = 0

  constructor(
    private readonly chunkSamples: number,
    private readonly onChunk: (chunk: Float32Array) => void
  ) {
    if (chunkSamples <= 0) throw new Error('chunkSamples must be positive')
  }

  /** Append a frame; emits zero or more fixed-size chunks as capacity fills. */
  push(frame: Float32Array): void {
    if (frame.length === 0) return
    this.pending.push(frame)
    this.pendingLength += frame.length

    while (this.pendingLength >= this.chunkSamples) {
      this.onChunk(this.take(this.chunkSamples))
    }
  }

  /** Drop any buffered partial samples without emitting (e.g. on stop/reset). */
  reset(): void {
    this.pending = []
    this.pendingLength = 0
  }

  /** Consume exactly `count` samples from the front of the pending buffers. */
  private take(count: number): Float32Array {
    const out = new Float32Array(count)
    let filled = 0
    while (filled < count) {
      const head = this.pending[0]
      const remaining = count - filled
      if (head.length <= remaining) {
        out.set(head, filled)
        filled += head.length
        this.pending.shift()
      } else {
        out.set(head.subarray(0, remaining), filled)
        this.pending[0] = head.subarray(remaining)
        filled += remaining
      }
    }
    this.pendingLength -= count
    return out
  }
}
