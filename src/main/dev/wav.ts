/**
 * Minimal 16-bit PCM mono WAV reader for the dev shadow harness (#730).
 *
 * The benchmark/ package deliberately keeps its own standalone copies of every
 * helper it needs (it runs under plain tsx with a separate tsconfig and cannot
 * import from src/). This reader is the src/-side counterpart, kept small rather
 * than reaching across that boundary.
 */

import { readFileSync } from 'fs'

export interface WavData {
  /** Mono PCM samples in [-1, 1]. */
  samples: Float32Array
  sampleRate: number
}

/** Parse a 16-bit PCM mono WAV file into Float32 mono samples. */
export function readWav(path: string): WavData {
  const buffer = readFileSync(path)
  if (buffer.length < 44) throw new Error(`WAV file is too small: ${path}`)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${path}`)
  }

  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataStart = -1
  let dataLen = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10)
      sampleRate = buffer.readUInt32LE(offset + 12)
      bitsPerSample = buffer.readUInt16LE(offset + 22)
    } else if (id === 'data') {
      dataStart = offset + 8
      dataLen = size
      break
    }
    offset += 8 + size
  }
  if (dataStart < 0) throw new Error(`No "data" chunk in WAV: ${path}`)
  if (bitsPerSample !== 16) {
    throw new Error(`Only 16-bit PCM WAV is supported. Got ${bitsPerSample}-bit: ${path}`)
  }
  if (channels !== 1) {
    throw new Error(`Only mono WAV is supported. Got ${channels} channels: ${path}`)
  }

  const numSamples = Math.min(dataLen, buffer.length - dataStart) / 2
  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768
  }
  return { samples, sampleRate }
}
