import { describe, it, expect } from 'vitest'
import {
  properNounBreakage,
  scoreQuality,
  buildPathReport,
  recommendDefault,
  buildMultivariateReport,
  type MultivariatePathInput
} from './multivariate'

describe('properNounBreakage', () => {
  it('returns 0 when there are no proper nouns to check', () => {
    expect(properNounBreakage('anything', [])).toBe(0)
  })

  it('returns the fraction of missing proper nouns (case-insensitive)', () => {
    const hyp = 'We migrated to Kotlin and Ktor last year.'
    expect(properNounBreakage(hyp, ['kotlin', 'ktor'])).toBe(0)
    expect(properNounBreakage(hyp, ['Kotlin', 'Rails'])).toBe(0.5)
    expect(properNounBreakage(hyp, ['Rails', 'Django'])).toBe(1)
  })
})

describe('scoreQuality', () => {
  it('averages chrF and proper-noun breakage across sentences', () => {
    const q = scoreQuality([
      { hypothesis: 'hello world', reference: 'hello world', properNouns: ['hello'] },
      { hypothesis: 'foo', reference: 'completely different', properNouns: ['bar'] }
    ])
    expect(q.meanChrF).toBeGreaterThan(0)
    expect(q.meanChrF).toBeLessThan(100)
    // first sentence: 0 breakage, second: 1.0 breakage -> mean 0.5
    expect(q.properNounBreakage).toBeCloseTo(0.5, 6)
  })

  it('handles empty input', () => {
    expect(scoreQuality([])).toEqual({ meanChrF: 0, properNounBreakage: 0 })
  })
})

describe('buildPathReport', () => {
  it('produces all five multivariate axes', () => {
    const input: MultivariatePathInput = {
      pathId: 'offline-llm',
      label: 'HY-MT1.5 (offline)',
      isOffline: true,
      usdPerMillionChars: 0,
      sentences: [{ hypothesis: 'good output', reference: 'good output' }],
      latenciesMs: [180, 200, 220, 500],
      sourceCharsTotal: 1000,
      supportsGlossary: true,
      supportsArbitrarySurface: true
    }
    const report = buildPathReport(input)
    expect(report.quality.meanChrF).toBeGreaterThan(99)
    expect(report.latency.p50).toBeGreaterThan(0)
    expect(report.latency.p95).toBeGreaterThanOrEqual(report.latency.p50)
    expect(report.cost.totalUsd).toBe(0) // offline
    expect(report.privacy.offlineCompleteness).toBe(1)
    expect(report.value.supportsGlossary).toBe(true)
  })

  it('meters cloud cost from source characters', () => {
    const report = buildPathReport({
      pathId: 'cloud',
      label: 'Cloud API',
      isOffline: false,
      usdPerMillionChars: 20,
      sentences: [{ hypothesis: 'x', reference: 'x' }],
      latenciesMs: [50],
      sourceCharsTotal: 500_000,
      supportsGlossary: false,
      supportsArbitrarySurface: false
    })
    expect(report.cost.totalUsd).toBeCloseTo(10, 6) // 0.5M chars * $20/M
    expect(report.privacy.offlineCompleteness).toBe(0)
  })
})

describe('recommendDefault (decision rule)', () => {
  const offline = buildPathReport({
    pathId: 'offline',
    label: 'Offline hybrid',
    isOffline: true,
    usdPerMillionChars: 0,
    sentences: [{ hypothesis: 'The new parser improved recovery.', reference: 'The new parser improved recovery.' }],
    latenciesMs: [180],
    sourceCharsTotal: 1000,
    supportsGlossary: true,
    supportsArbitrarySurface: true
  })

  it('prefers cost/privacy/value on a quality tie (keeps switchable hybrid)', () => {
    // Cloud path is marginally better on chrF but within the tie delta.
    const cloud = buildPathReport({
      pathId: 'cloud',
      label: 'Cloud API',
      isOffline: false,
      usdPerMillionChars: 20,
      sentences: [{ hypothesis: 'The new parser improved recovery.', reference: 'The new parser improved recovery.' }],
      latenciesMs: [60],
      sourceCharsTotal: 1000,
      supportsGlossary: false,
      supportsArbitrarySurface: false
    })
    const rec = recommendDefault([cloud, offline], 2)
    expect(rec.qualityTiedPathIds.sort()).toEqual(['cloud', 'offline'])
    // On a tie, offline (privacy) wins over the cloud path.
    expect(rec.pathId).toBe('offline')
  })

  it('picks the clearly higher-quality path when not tied', () => {
    const poor = buildPathReport({
      pathId: 'poor',
      label: 'Poor path',
      isOffline: true,
      usdPerMillionChars: 0,
      sentences: [{ hypothesis: 'unrelated text', reference: 'The new parser improved recovery.' }],
      latenciesMs: [100],
      sourceCharsTotal: 1000,
      supportsGlossary: false,
      supportsArbitrarySurface: false
    })
    const rec = recommendDefault([offline, poor], 2)
    expect(rec.pathId).toBe('offline')
    expect(rec.qualityTiedPathIds).toEqual(['offline'])
  })

  it('handles no paths', () => {
    expect(recommendDefault([]).pathId).toBeNull()
  })
})

describe('buildMultivariateReport (smoke)', () => {
  it('produces a full report end-to-end', () => {
    const inputs: MultivariatePathInput[] = [
      {
        pathId: 'cascade-offline',
        label: 'Whisper + HY-MT1.5',
        isOffline: true,
        usdPerMillionChars: 0,
        sentences: [
          { hypothesis: 'We adopted Kotlin.', reference: 'We adopted Kotlin.', properNouns: ['Kotlin'] }
        ],
        latenciesMs: [180, 210],
        sourceCharsTotal: 400,
        supportsGlossary: true,
        supportsArbitrarySurface: true
      },
      {
        pathId: 'cloud-realtime',
        label: 'Cloud realtime',
        isOffline: false,
        usdPerMillionChars: 16,
        sentences: [
          { hypothesis: 'We used Kotlin.', reference: 'We adopted Kotlin.', properNouns: ['Kotlin'] }
        ],
        latenciesMs: [70, 90],
        sourceCharsTotal: 400,
        supportsGlossary: false,
        supportsArbitrarySurface: false
      }
    ]
    const report = buildMultivariateReport(inputs)
    expect(report.paths).toHaveLength(2)
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.recommendation.pathId).not.toBeNull()
    // Every path carries all five axes.
    for (const p of report.paths) {
      expect(p.quality).toBeDefined()
      expect(p.latency).toBeDefined()
      expect(p.cost).toBeDefined()
      expect(p.privacy).toBeDefined()
      expect(p.value).toBeDefined()
    }
  })
})
