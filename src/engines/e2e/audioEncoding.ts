/**
 * Audio encoding helpers for cloud realtime speech-translation engines.
 *
 * The #721 realtime capture adapter emits mono float32 PCM at 16 kHz in ~100ms
 * chunks. OpenAI's gpt-realtime-translate endpoint expects base64-encoded
 * little-endian PCM16 at 24 kHz. These pure functions bridge the two formats and
 * are unit-tested in isolation (no WebSocket / network involved).
 */

/** Default sample rate produced by the #721 realtime capture adapter. */
export const SOURCE_SAMPLE_RATE = 16000
/** Sample rate required by the gpt-realtime-translate input buffer. */
export const TARGET_SAMPLE_RATE = 24000

/**
 * Resample a mono float32 buffer using linear interpolation.
 * Returns the input unchanged when the rates match or the buffer is empty.
 *
 * Interpolation phase is not carried across calls. This is seam-clean for the
 * 16k→24k path (ratio 3/2) as long as each chunk length is a multiple of 2 —
 * which the #721 RealtimeChunker guarantees by emitting fixed 1600-sample
 * (100ms @ 16kHz) chunks. Callers feeding variable-length chunks may get a
 * minor discontinuity at chunk boundaries.
 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error('sample rates must be positive')
  if (fromRate === toRate || input.length === 0) return input

  const ratio = toRate / fromRate
  const outLength = Math.max(1, Math.round(input.length * ratio))
  const output = new Float32Array(outLength)

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = srcPos - i0
    output[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return output
}

/**
 * Convert mono float32 samples in [-1, 1] to little-endian signed PCM16.
 * Values are clamped before scaling to avoid wrap-around on overflow.
 */
export function float32ToPcm16(input: Float32Array): Buffer {
  const buffer = Buffer.alloc(input.length * 2)
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]))
    // Asymmetric scaling: negative range is -32768, positive range is +32767.
    const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    buffer.writeInt16LE(Math.round(sample), i * 2)
  }
  return buffer
}

/**
 * Resample a captured float32 chunk to {@link TARGET_SAMPLE_RATE} and encode it
 * as a base64 little-endian PCM16 string ready for `input_audio_buffer.append`.
 */
export function encodePcm16Base64(
  chunk: Float32Array,
  fromRate: number = SOURCE_SAMPLE_RATE,
  toRate: number = TARGET_SAMPLE_RATE
): string {
  const resampled = resampleLinear(chunk, fromRate, toRate)
  return float32ToPcm16(resampled).toString('base64')
}
