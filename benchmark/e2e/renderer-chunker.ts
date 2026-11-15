/**
 * Replica of the cascade-mode chunking in src/renderer/hooks/useAudioCapture.ts
 * (rolling buffer, silence trim, chunk overlap). The renderer keeps this logic
 * inside a React hook, so it cannot be imported; keep the constants in sync.
 */
import { SAMPLE_RATE } from './vad-node'

export const DEFAULT_STREAMING_INTERVAL_MS = 800
const MAX_ROLLING_BUFFER_SECONDS = 3
const CHUNK_OVERLAP_SAMPLES = Math.floor(SAMPLE_RATE * 0.2)
const SILENCE_RMS_THRESHOLD = 0.01

export function trimSilence(buffer: Float32Array): Float32Array | null {
  const frameSize = 160
  const padding = 160
  let firstSpeechSample = -1
  let lastSpeechSample = -1

  for (let i = 0; i < buffer.length; i += frameSize) {
    const end = Math.min(i + frameSize, buffer.length)
    let sum = 0
    for (let j = i; j < end; j++) sum += buffer[j] * buffer[j]
    const rms = Math.sqrt(sum / (end - i))
    if (rms > SILENCE_RMS_THRESHOLD) {
      if (firstSpeechSample === -1) firstSpeechSample = i
      lastSpeechSample = end
    }
  }

  if (firstSpeechSample === -1) return null
  const start = Math.max(0, firstSpeechSample - padding)
  const end = Math.min(buffer.length, lastSpeechSample + padding)
  const trimmedLength = end - start
  if (trimmedLength >= buffer.length * 0.8) return buffer
  if (trimmedLength < SAMPLE_RATE * 0.3) return null
  return buffer.subarray(start, end)
}

export class RollingChunker {
  private frames: Float32Array[] = []
  private index = 0
  private full = false
  private prevTail: Float32Array | null = null
  speaking = false

  reset(): void {
    this.frames = []
    this.index = 0
    this.full = false
    this.prevTail = null
  }

  /** Called for every VAD frame, before the speech-start event of the same frame. */
  onFrame(frame: Float32Array): void {
    if (!this.speaking) return
    const maxFrames = Math.floor((MAX_ROLLING_BUFFER_SECONDS * SAMPLE_RATE) / frame.length)
    if (this.frames.length < maxFrames && !this.full) {
      this.frames.push(new Float32Array(frame))
      this.index = this.frames.length
    } else {
      if (this.frames.length < maxFrames) this.frames.length = maxFrames
      this.full = true
      const idx = this.index % maxFrames
      this.frames[idx] = new Float32Array(frame)
      this.index = (idx + 1) % maxFrames
    }
  }

  private getRollingBuffer(): Float32Array | null {
    const count = this.full ? this.frames.length : this.index
    if (count === 0) return null
    const ordered = this.full
      ? [...this.frames.slice(this.index), ...this.frames.slice(0, this.index)]
      : this.frames.slice(0, this.index)
    const total = ordered.reduce((s, f) => s + f.length, 0)
    if (total < SAMPLE_RATE * 0.5) return null
    const buffer = new Float32Array(total)
    let offset = 0
    for (const f of ordered) {
      buffer.set(f, offset)
      offset += f.length
    }
    return trimSilence(buffer)
  }

  /** The streaming timer tick: returns the chunk the renderer would send, or null. */
  tick(): Float32Array | null {
    if (!this.speaking) return null
    const buffer = this.getRollingBuffer()
    if (!buffer) return null
    const tail = this.prevTail
    let output: Float32Array
    if (tail && tail.length > 0) {
      output = new Float32Array(tail.length + buffer.length)
      output.set(tail, 0)
      output.set(buffer, tail.length)
    } else {
      output = buffer
    }
    this.prevTail = buffer.length > CHUNK_OVERLAP_SAMPLES
      ? buffer.slice(buffer.length - CHUNK_OVERLAP_SAMPLES)
      : new Float32Array(buffer)
    return output
  }
}
