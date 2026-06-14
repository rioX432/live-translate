/**
 * Lightweight WAV reader + linear resampler used by the GPT-Realtime-Whisper
 * benchmark. Kept local so the eval module has no extra ffmpeg dependency.
 *
 * The existing testset under benchmark/testset/stt-audio is 16-bit PCM mono
 * WAV at 16 kHz (matching whisper.cpp expectations). OpenAI's Realtime
 * transcription endpoint takes 24 kHz mono PCM16, so we upsample with a
 * simple linear interpolator. Linear resampling is sufficient for ASR
 * evaluation purposes because all engines compared in this benchmark use the
 * same source recording — we only need to compare across models, not against
 * a higher-quality resampler.
 */
import { readFileSync } from 'node:fs'

export interface WavData {
  /** Mono PCM samples in [-1, 1] (Float32). */
  samples: Float32Array
  sampleRate: number
}

/** Parse a 16-bit PCM mono WAV file into Float32 mono samples. */
export function readWav(path: string): WavData {
  const buffer = readFileSync(path)
  if (buffer.length < 44) {
    throw new Error(`WAV file is too small: ${path}`)
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${path}`)
  }

  // Walk chunks to find "fmt " and "data".
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
  if (dataStart < 0) {
    throw new Error(`No "data" chunk in WAV: ${path}`)
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Only 16-bit PCM WAV is supported. Got ${bitsPerSample}-bit: ${path}`)
  }
  if (channels !== 1) {
    throw new Error(`Only mono WAV is supported. Got ${channels} channels: ${path}`)
  }

  const numSamples = dataLen / 2
  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768
  }
  return { samples, sampleRate }
}

/**
 * Linear-interpolation resampler. Adequate for ASR evaluation where the same
 * source audio is sent to every engine; we do not need a polyphase / windowed
 * sinc filter to compare relative accuracy.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return input
  if (input.length === 0) return input
  const ratio = inputRate / outputRate
  const outLen = Math.round(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio
    const lo = Math.floor(srcIdx)
    const hi = Math.min(lo + 1, input.length - 1)
    const frac = srcIdx - lo
    out[i] = input[lo]! * (1 - frac) + input[hi]! * frac
  }
  return out
}

/**
 * Convert Float32 mono samples in [-1, 1] to 16-bit PCM little-endian bytes.
 * Uses the full signed int16 range [-32768, 32767]: negative samples scale by
 * 32768 and positive samples by 32767, then we clamp to [-32768, 32767].
 */
export function float32ToPcm16(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    const scaled = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767)
    const clamped = Math.max(-32768, Math.min(32767, scaled))
    buf.writeInt16LE(clamped, i * 2)
  }
  return buf
}
