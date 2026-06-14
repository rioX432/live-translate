/**
 * Unit tests for the cost projection helpers.
 */
import { describe, it, expect } from 'vitest'

import { GPT_REALTIME_WHISPER_USD_PER_MINUTE, formatUsd, projectMonthlyUsd } from './cost'

describe('projectMonthlyUsd', () => {
  it('computes USD cost for the documented price', () => {
    // 4h/day * 22 days = 88h = 5,280 minutes. 5,280 * 0.017 = 89.76 USD.
    const usd = projectMonthlyUsd(4, 22)
    expect(Number(usd.toFixed(2))).toBe(89.76)
  })

  it('is linear in hoursPerDay', () => {
    const oneHour = projectMonthlyUsd(1, 22)
    const fourHours = projectMonthlyUsd(4, 22)
    expect(Number((fourHours / oneHour).toFixed(6))).toBe(4)
  })

  it('treats zero usage as zero cost', () => {
    expect(projectMonthlyUsd(0, 22)).toBe(0)
    expect(projectMonthlyUsd(8, 0)).toBe(0)
  })

  it('rejects negative inputs', () => {
    expect(() => projectMonthlyUsd(-1, 22)).toThrow()
    expect(() => projectMonthlyUsd(1, -22)).toThrow()
  })
})

describe('GPT_REALTIME_WHISPER_USD_PER_MINUTE', () => {
  it('matches the public price card (2026-05-07)', () => {
    expect(GPT_REALTIME_WHISPER_USD_PER_MINUTE).toBe(0.017)
  })
})

describe('formatUsd', () => {
  it('produces a stable USD string', () => {
    expect(formatUsd(89.7621)).toBe('$89.76')
    expect(formatUsd(0, 2)).toBe('$0.00')
    expect(formatUsd(1.2345, 4)).toBe('$1.2345')
  })
})
