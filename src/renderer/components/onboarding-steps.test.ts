import { describe, it, expect } from 'vitest'
import {
  pickInitialStep,
  nextStep,
  formatSize,
  TIER1_TOTAL_MB,
  TIER2_TOTAL_MB
} from './onboarding-steps'

describe('Onboarding step constants (#708)', () => {
  it('declares Tier 1 ~371MB and Tier 2 ~1.6GB to match onboarding-downloader.ts', () => {
    expect(TIER1_TOTAL_MB).toBe(371)
    expect(TIER2_TOTAL_MB).toBeGreaterThan(1500)
    expect(TIER2_TOTAL_MB).toBeLessThan(1800)
  })
})

describe('pickInitialStep (#708)', () => {
  it('starts at quick-start when no models are downloaded yet', () => {
    expect(
      pickInitialStep({ tier1Ready: false, tier2Ready: false, status: 'idle' })
    ).toBe('quick-start')
  })

  it('starts at quality-upgrade when Tier 1 is ready but Tier 2 is not', () => {
    expect(
      pickInitialStep({ tier1Ready: true, tier2Ready: false, status: 'downloading-tier2' })
    ).toBe('quality-upgrade')
  })

  it('stays at quality-upgrade when both tiers are ready', () => {
    expect(
      pickInitialStep({ tier1Ready: true, tier2Ready: true, status: 'all-ready' })
    ).toBe('quality-upgrade')
  })

  it('treats failed downloads with no Tier 1 as a fresh start', () => {
    expect(
      pickInitialStep({ tier1Ready: false, tier2Ready: false, status: 'failed' })
    ).toBe('quick-start')
  })
})

describe('nextStep (#708)', () => {
  it('advances quick-start → quality-upgrade', () => {
    expect(nextStep('quick-start')).toBe('quality-upgrade')
  })

  it('advances quality-upgrade → done', () => {
    expect(nextStep('quality-upgrade')).toBe('done')
  })

  it('done stays done (idempotent)', () => {
    expect(nextStep('done')).toBe('done')
  })
})

describe('formatSize (#708)', () => {
  it('renders sub-gigabyte values as MB', () => {
    expect(formatSize(371)).toBe('371MB')
  })

  it('renders gigabyte values with one decimal place', () => {
    expect(formatSize(1640)).toBe('1.6GB')
  })

  it('renders large gigabyte values without decimals', () => {
    expect(formatSize(10240)).toBe('10GB')
  })
})
