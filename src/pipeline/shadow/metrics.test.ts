import { describe, it, expect } from 'vitest'
import { estimateCostUsd } from './metrics'

const NO_AUDIO = { sourceChars: 0, audioDurationMs: 0 }

describe('estimateCostUsd', () => {
  it('bills text-metered paths per source character', () => {
    const cost = estimateCostUsd({ ...NO_AUDIO, sourceChars: 500_000, cost: { usdPerMillionChars: 20 } })
    expect(cost).toBeCloseTo(10, 10)
  })

  it('bills speech-metered paths per audio minute', () => {
    // gpt-realtime-translate: $0.034/min. 30s of audio = half a minute.
    const cost = estimateCostUsd({
      ...NO_AUDIO,
      audioDurationMs: 30_000,
      cost: { usdPerAudioMinute: 0.034 }
    })
    expect(cost).toBeCloseTo(0.017, 10)
  })

  it('sums both dimensions for a path metered on characters AND audio', () => {
    const cost = estimateCostUsd({
      sourceChars: 1_000_000,
      audioDurationMs: 60_000,
      cost: { usdPerMillionChars: 20, usdPerAudioMinute: 0.034 }
    })
    expect(cost).toBeCloseTo(20.034, 10)
  })

  it('charges nothing for an offline path regardless of quantities', () => {
    expect(estimateCostUsd({ sourceChars: 10_000, audioDurationMs: 60_000, cost: {} })).toBe(0)
    expect(
      estimateCostUsd({
        sourceChars: 10_000,
        audioDurationMs: 60_000,
        cost: { usdPerMillionChars: 0, usdPerAudioMinute: 0 }
      })
    ).toBe(0)
  })

  it('ignores a dimension whose quantity is missing rather than billing it', () => {
    // A per-minute path whose duration is unknown must not silently bill zero-rate
    // characters or produce NaN.
    expect(estimateCostUsd({ ...NO_AUDIO, sourceChars: 100, cost: { usdPerAudioMinute: 0.034 } })).toBe(0)
  })

  it('returns 0 rather than NaN for non-finite or negative quantities', () => {
    const cost = { usdPerMillionChars: 20, usdPerAudioMinute: 0.034 }
    expect(estimateCostUsd({ sourceChars: NaN, audioDurationMs: NaN, cost })).toBe(0)
    expect(estimateCostUsd({ sourceChars: Infinity, audioDurationMs: Infinity, cost })).toBe(0)
    expect(estimateCostUsd({ sourceChars: -5, audioDurationMs: -5, cost })).toBe(0)
  })
})
