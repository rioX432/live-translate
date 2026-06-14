import { describe, it, expect } from 'vitest'
import {
  pickInitialStep,
  nextStep,
  isAzureKeyValid,
  formatSize,
  AZURE_TRANSLATOR_PORTAL_URL,
  AZURE_FREE_TIER_CHARS,
  TIER1_TOTAL_MB,
  TIER2_TOTAL_MB
} from './onboarding-steps'

describe('Onboarding step constants (#708)', () => {
  it('exposes the official Azure Translator portal "create" deep link', () => {
    expect(AZURE_TRANSLATOR_PORTAL_URL).toBe(
      'https://portal.azure.com/#create/Microsoft.CognitiveServicesTextTranslation'
    )
  })

  it('advertises the Azure F0 free tier quota', () => {
    expect(AZURE_FREE_TIER_CHARS).toBe('2M chars/month')
  })

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

  it('starts at cloud-boost when both tiers are ready', () => {
    expect(
      pickInitialStep({ tier1Ready: true, tier2Ready: true, status: 'all-ready' })
    ).toBe('cloud-boost')
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

  it('advances quality-upgrade → cloud-boost', () => {
    expect(nextStep('quality-upgrade')).toBe('cloud-boost')
  })

  it('cloud-boost is the terminal step', () => {
    expect(nextStep('cloud-boost')).toBe('done')
  })

  it('done stays done (idempotent)', () => {
    expect(nextStep('done')).toBe('done')
  })
})

describe('isAzureKeyValid (#708)', () => {
  it('requires both key and region to be non-empty', () => {
    expect(isAzureKeyValid('abc123', 'eastus')).toBe(true)
  })

  it('rejects a missing key', () => {
    expect(isAzureKeyValid('', 'eastus')).toBe(false)
  })

  it('rejects a missing region', () => {
    expect(isAzureKeyValid('abc123', '')).toBe(false)
  })

  it('treats whitespace-only values as missing', () => {
    expect(isAzureKeyValid('   ', 'eastus')).toBe(false)
    expect(isAzureKeyValid('abc123', '  ')).toBe(false)
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
