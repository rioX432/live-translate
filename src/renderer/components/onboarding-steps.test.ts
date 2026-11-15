import { describe, it, expect } from 'vitest'
import { nextStep, formatSize, isDownloading } from './onboarding-steps'

describe('nextStep', () => {
  it('finishes after the download step', () => {
    expect(nextStep('download')).toBe('done')
  })

  it('done stays done (idempotent)', () => {
    expect(nextStep('done')).toBe('done')
  })
})

describe('isDownloading', () => {
  it('is true only while main reports a running download', () => {
    expect(isDownloading('downloading-tier1')).toBe(true)
    expect(isDownloading('downloading-tier2')).toBe(true)
    expect(isDownloading('idle')).toBe(false)
    expect(isDownloading('all-ready')).toBe(false)
    expect(isDownloading('failed')).toBe(false)
  })
})

describe('formatSize', () => {
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
