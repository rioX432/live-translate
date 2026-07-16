import { describe, it, expect } from 'vitest'
import { resampleLinear, float32ToPcm16, encodePcm16Base64 } from './audioEncoding'

describe('resampleLinear', () => {
  it('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(resampleLinear(input, 16000, 16000)).toBe(input)
  })

  it('returns empty for empty input', () => {
    const out = resampleLinear(new Float32Array(0), 16000, 24000)
    expect(out.length).toBe(0)
  })

  it('upsamples 16kHz to 24kHz by ~1.5x length', () => {
    const input = new Float32Array(1600) // 100ms @ 16kHz
    const out = resampleLinear(input, 16000, 24000)
    expect(out.length).toBe(2400) // 100ms @ 24kHz
  })

  it('linearly interpolates between samples', () => {
    // 2x upsample of [0, 1]: positions 0, 0.5, 1 (clamped) → 0, 0.5, 1
    const out = resampleLinear(new Float32Array([0, 1]), 1, 2)
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0)
    expect(out[1]).toBeCloseTo(0.5)
    expect(out[2]).toBeCloseTo(1)
  })

  it('throws on non-positive rates', () => {
    expect(() => resampleLinear(new Float32Array([1]), 0, 24000)).toThrow()
  })
})

describe('float32ToPcm16', () => {
  it('maps 0, +1, -1 to the correct little-endian int16 values', () => {
    const buf = float32ToPcm16(new Float32Array([0, 1, -1]))
    expect(buf.length).toBe(6)
    expect(buf.readInt16LE(0)).toBe(0)
    expect(buf.readInt16LE(2)).toBe(32767)
    expect(buf.readInt16LE(4)).toBe(-32768)
  })

  it('clamps out-of-range values instead of wrapping', () => {
    const buf = float32ToPcm16(new Float32Array([2, -2]))
    expect(buf.readInt16LE(0)).toBe(32767)
    expect(buf.readInt16LE(2)).toBe(-32768)
  })

  it('writes little-endian byte order', () => {
    // 0.5 * 32767 = 16383.5 → rounds to 16384 (0x4000) → LE bytes 0x00 0x40
    const buf = float32ToPcm16(new Float32Array([0.5]))
    const value = Math.round(0.5 * 0x7fff)
    expect(buf.readInt16LE(0)).toBe(value)
    expect(buf[0]).toBe(value & 0xff)
    expect(buf[1]).toBe((value >> 8) & 0xff)
  })
})

describe('encodePcm16Base64', () => {
  it('produces base64 decodable to resampled PCM16 sample count', () => {
    const chunk = new Float32Array(1600) // 100ms @ 16kHz → 2400 @ 24kHz → 4800 bytes
    const b64 = encodePcm16Base64(chunk, 16000, 24000)
    const decoded = Buffer.from(b64, 'base64')
    expect(decoded.length).toBe(2400 * 2)
  })

  it('round-trips sample values through base64', () => {
    const chunk = new Float32Array([1, -1, 0])
    const b64 = encodePcm16Base64(chunk, 16000, 16000) // no resample
    const decoded = Buffer.from(b64, 'base64')
    expect(decoded.readInt16LE(0)).toBe(32767)
    expect(decoded.readInt16LE(2)).toBe(-32768)
    expect(decoded.readInt16LE(4)).toBe(0)
  })
})
