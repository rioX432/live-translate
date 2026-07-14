import { describe, it, expect } from 'vitest'
import { RealtimeChunker } from './realtimeChunker'

const CHUNK = 1600 // 100ms at 16kHz

function collect(): { chunks: Float32Array[]; onChunk: (c: Float32Array) => void } {
  const chunks: Float32Array[] = []
  return { chunks, onChunk: (c) => chunks.push(c) }
}

describe('RealtimeChunker', () => {
  it('emits fixed-size chunks from larger-than-chunk frames, carrying the remainder', () => {
    const { chunks, onChunk } = collect()
    const chunker = new RealtimeChunker(CHUNK, onChunk)

    // A frame larger than one chunk (4000 samples) yields multiple chunks
    chunker.push(new Float32Array(4000).fill(0.5))
    expect(chunks).toHaveLength(2) // 3200 emitted, 800 carried
    expect(chunks.every((c) => c.length === CHUNK)).toBe(true)

    chunker.push(new Float32Array(2400).fill(0.5))
    expect(chunks).toHaveLength(4) // 800 + 2400 = 3200 -> two more chunks
  })

  it('accumulates sub-chunk frames until a full chunk is available (continuity)', () => {
    const { chunks, onChunk } = collect()
    const chunker = new RealtimeChunker(CHUNK, onChunk)

    // Feed 20 small frames of 512 samples = 10240 samples
    for (let i = 0; i < 20; i++) chunker.push(new Float32Array(512).fill(1))
    // 10240 / 1600 = 6 full chunks, 640 carried
    expect(chunks).toHaveLength(6)
  })

  it('preserves every sample in order across chunk boundaries', () => {
    const { chunks, onChunk } = collect()
    const chunker = new RealtimeChunker(CHUNK, onChunk)

    // Build a ramp so we can verify no sample is dropped/duplicated/reordered
    const total = CHUNK * 3 + 500
    const source = new Float32Array(total)
    for (let i = 0; i < total; i++) source[i] = i

    // Push in irregular frame sizes
    let offset = 0
    for (const size of [700, 1600, 300, 2500, total - 700 - 1600 - 300 - 2500]) {
      chunker.push(source.subarray(offset, offset + size))
      offset += size
    }

    expect(chunks).toHaveLength(3) // 500 samples carried, not emitted
    const flat = new Float32Array(chunks.length * CHUNK)
    chunks.forEach((c, i) => flat.set(c, i * CHUNK))
    for (let i = 0; i < flat.length; i++) expect(flat[i]).toBe(i)
  })

  it('reset() drops the buffered remainder', () => {
    const { chunks, onChunk } = collect()
    const chunker = new RealtimeChunker(CHUNK, onChunk)

    chunker.push(new Float32Array(1000))
    chunker.reset()
    chunker.push(new Float32Array(700)) // 700, not 1700 — remainder was dropped
    expect(chunks).toHaveLength(0)
  })

  it('ignores empty frames', () => {
    const { chunks, onChunk } = collect()
    const chunker = new RealtimeChunker(CHUNK, onChunk)
    chunker.push(new Float32Array(0))
    expect(chunks).toHaveLength(0)
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => new RealtimeChunker(0, () => {})).toThrow()
  })
})
