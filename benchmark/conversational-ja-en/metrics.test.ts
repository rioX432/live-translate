import { describe, it, expect } from 'vitest'
import { chrF, percentile, scoreSentence } from './metrics'

describe('chrF metric', () => {
  it('returns 100 for identical strings', () => {
    const score = chrF('hello world', 'hello world')
    expect(score).toBeGreaterThan(99)
  })

  it('returns 0 when either side is empty', () => {
    expect(chrF('', 'hello')).toBe(0)
    expect(chrF('hello', '')).toBe(0)
    expect(chrF('   ', 'hello')).toBe(0)
  })

  it('returns higher score for closer translations', () => {
    const reference = 'The new parser has significantly improved error recovery.'
    const good = 'The new parser has significantly improved error recovery.'
    const partial = 'The parser improved error recovery.'
    const poor = 'Cats and dogs are common household pets.'

    const goodScore = chrF(good, reference)
    const partialScore = chrF(partial, reference)
    const poorScore = chrF(poor, reference)

    expect(goodScore).toBeGreaterThan(partialScore)
    expect(partialScore).toBeGreaterThan(poorScore)
  })

  it('handles Japanese (multi-byte) text correctly', () => {
    const reference = 'おはようございます'
    const exact = 'おはようございます'
    const partial = 'おはよう'
    const wrong = 'こんばんは'

    expect(chrF(exact, reference)).toBeGreaterThan(99)
    expect(chrF(partial, reference)).toBeGreaterThan(chrF(wrong, reference))
  })

  it('scoreSentence returns chrF in [0, 100]', () => {
    const score = scoreSentence('hello', 'hello world')
    expect(score.chrF).toBeGreaterThanOrEqual(0)
    expect(score.chrF).toBeLessThanOrEqual(100)
  })
})

describe('percentile helper', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0)
  })

  it('returns the only value for single-element array', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
  })

  it('returns the median correctly for an odd-length sorted array', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
  })

  it('returns the max for p100', () => {
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50)
  })

  it('returns roughly p95 of a 100-element sorted array', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 95)).toBe(95)
    expect(percentile(values, 99)).toBe(99)
  })
})
