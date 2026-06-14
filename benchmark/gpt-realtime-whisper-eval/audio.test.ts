/**
 * Unit tests for the local WAV / resampler helpers.
 */
import { describe, it, expect } from 'vitest'

import { float32ToPcm16, resampleLinear } from './audio'

describe('resampleLinear', () => {
  it('is a no-op when rates match', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1])
    expect(resampleLinear(input, 16000, 16000)).toBe(input)
  })

  it('upsamples 16k -> 24k with the expected length ratio', () => {
    const input = new Float32Array(1600) // 100 ms @ 16k
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * i) / 100)
    const out = resampleLinear(input, 16000, 24000)
    // 1600 samples * (24000/16000) = 2400
    expect(out.length).toBe(2400)
  })

  it('preserves endpoints', () => {
    const input = new Float32Array([0.25, 0.5, 0.75, 1])
    const out = resampleLinear(input, 16000, 32000)
    expect(out[0]).toBe(0.25)
    // Last sample should equal the last input sample (boundary clamp).
    expect(out[out.length - 1]).toBe(1)
  })

  it('handles empty input', () => {
    expect(resampleLinear(new Float32Array(0), 16000, 24000).length).toBe(0)
  })
})

describe('float32ToPcm16', () => {
  it('clamps out-of-range samples to int16 limits and rounds', () => {
    const input = new Float32Array([0, 1, -1, 2, -2, 0.5])
    const pcm = float32ToPcm16(input)
    // Expected: 0, 32767 (positive scale by 32767), -32768 (negative scale by 32768),
    // 32767 (clamped), -32768 (clamped), 16384 (round of 0.5 * 32767 = 16383.5)
    expect(pcm.readInt16LE(0)).toBe(0)
    expect(pcm.readInt16LE(2)).toBe(32767)
    expect(pcm.readInt16LE(4)).toBe(-32768)
    expect(pcm.readInt16LE(6)).toBe(32767)
    expect(pcm.readInt16LE(8)).toBe(-32768)
    expect(pcm.readInt16LE(10)).toBe(16384)
  })
})
