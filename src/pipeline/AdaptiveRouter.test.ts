import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AdaptiveRouter, DEFAULT_ROUTING_CONFIG } from './AdaptiveRouter'
import type { TranslatorEngine, TranslateContext } from '../engines/types'

/** Create a mock translator engine */
function createMockEngine(id: string, latencyMs = 10): TranslatorEngine {
  return {
    id,
    name: `Mock ${id}`,
    isOffline: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockImplementation(async (text: string) => {
      await new Promise((r) => setTimeout(r, latencyMs))
      return `[${id}] ${text}`
    }),
    dispose: vi.fn().mockResolvedValue(undefined)
  }
}

describe('AdaptiveRouter', () => {
  let router: AdaptiveRouter

  beforeEach(() => {
    router = new AdaptiveRouter()
  })

  // --- Tokenization ---

  describe('tokenize', () => {
    it('splits English text by whitespace', () => {
      const tokens = AdaptiveRouter.tokenize('Hello world')
      expect(tokens).toEqual(['hello', 'world'])
    })

    it('splits CJK characters individually', () => {
      const tokens = AdaptiveRouter.tokenize('こんにちは世界')
      expect(tokens).toHaveLength(7)
      expect(tokens[0]).toBe('こ')
    })

    it('handles mixed CJK and Latin text', () => {
      const tokens = AdaptiveRouter.tokenize('Hello 世界')
      expect(tokens).toEqual(['hello', '世', '界'])
    })

    it('handles empty string', () => {
      expect(AdaptiveRouter.tokenize('')).toEqual([])
    })

    it('handles multiple spaces', () => {
      const tokens = AdaptiveRouter.tokenize('  hello   world  ')
      expect(tokens).toEqual(['hello', 'world'])
    })
  })

  // --- Rarity Score ---

  describe('calculateRarityScore', () => {
    it('returns 0 for all common words', () => {
      const tokens = ['the', 'is', 'a', 'good']
      expect(AdaptiveRouter.calculateRarityScore(tokens)).toBe(0)
    })

    it('returns > 0 for uncommon words', () => {
      const tokens = ['algorithm', 'optimization', 'paradigm']
      expect(AdaptiveRouter.calculateRarityScore(tokens)).toBeGreaterThan(0)
    })

    it('returns 1.0 for all uncommon words', () => {
      const tokens = ['photosynthesis', 'mitochondria', 'biochemistry']
      expect(AdaptiveRouter.calculateRarityScore(tokens)).toBe(1)
    })

    it('returns 0 for empty token list', () => {
      expect(AdaptiveRouter.calculateRarityScore([])).toBe(0)
    })

    it('ignores CJK tokens in rarity calculation', () => {
      const tokens = ['こ', 'ん', 'に', 'ち', 'は']
      expect(AdaptiveRouter.calculateRarityScore(tokens)).toBe(0)
    })
  })

  // --- Glossary matching ---

  describe('hasGlossaryMatch', () => {
    it('returns false with empty glossary', () => {
      expect(router.hasGlossaryMatch('hello world')).toBe(false)
    })

    it('detects glossary terms in text (case-insensitive)', () => {
      router.setGlossary([{ source: 'API', target: 'API' }])
      expect(router.hasGlossaryMatch('The API endpoint')).toBe(true)
      expect(router.hasGlossaryMatch('the api endpoint')).toBe(true)
    })

    it('returns false when no glossary terms match', () => {
      router.setGlossary([{ source: 'API', target: 'API' }])
      expect(router.hasGlossaryMatch('Hello world')).toBe(false)
    })
  })

  // --- Complexity Scoring ---

  describe('scoreComplexity', () => {
    it('routes short text to fast tier', () => {
      const result = router.scoreComplexity('Hello')
      expect(result.tier).toBe('fast')
      expect(result.tokenCount).toBe(1)
    })

    it('routes very long text to quality tier', () => {
      const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
      const result = router.scoreComplexity(longText)
      expect(result.tier).toBe('quality')
      expect(result.tokenCount).toBeGreaterThanOrEqual(50)
    })

    it('uses fast for short text below shortThreshold', () => {
      const text = 'Thank you very much'
      const result = router.scoreComplexity(text)
      expect(result.tokenCount).toBeLessThan(DEFAULT_ROUTING_CONFIG.shortThreshold)
      expect(result.tier).toBe('fast')
    })

    it('considers glossary terms in scoring', () => {
      router.setGlossary([{ source: 'Kubernetes', target: 'Kubernetes' }])
      // Medium length text with glossary term
      const text = 'The Kubernetes orchestration platform manages container deployments across the infrastructure'
      const withGlossary = router.scoreComplexity(text)

      router.setGlossary([])
      const withoutGlossary = router.scoreComplexity(text)

      expect(withGlossary.hasGlossaryTerms).toBe(true)
      expect(withoutGlossary.hasGlossaryTerms).toBe(false)
      expect(withGlossary.score).toBeGreaterThan(withoutGlossary.score)
    })

    it('returns score between 0 and 1', () => {
      const texts = [
        '',
        'Hi',
        'This is a medium-length sentence for testing.',
        Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
      ]
      for (const text of texts) {
        const result = router.scoreComplexity(text)
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })
  })

  // --- Threshold Configuration ---

  describe('configurable thresholds', () => {
    it('respects custom shortThreshold', () => {
      router.setConfig({ shortThreshold: 3 })
      // 2 tokens → should be fast
      expect(router.scoreComplexity('Hello world').tier).toBe('fast')
    })

    it('respects custom longThreshold', () => {
      router.setConfig({ shortThreshold: 3, longThreshold: 5 })
      const text = 'one two three four five six seven'
      expect(router.scoreComplexity(text).tier).toBe('quality')
    })

    it('setConfig merges with existing config', () => {
      router.setConfig({ shortThreshold: 5 })
      const config = router.getConfig()
      expect(config.shortThreshold).toBe(5)
      expect(config.longThreshold).toBe(DEFAULT_ROUTING_CONFIG.longThreshold)
    })
  })

  // --- Engine selection ---

  describe('translate', () => {
    it('routes short text to fast engine', async () => {
      const fast = createMockEngine('fast-engine')
      const quality = createMockEngine('quality-engine')
      router.setFastEngine(fast)
      router.setQualityEngine(quality)

      const result = await router.translate('Hi', 'en', 'ja')
      expect(result.engineId).toBe('fast-engine')
      expect(result.translated).toBe('[fast-engine] Hi')
    })

    it('routes long complex text to quality engine', async () => {
      const fast = createMockEngine('fast-engine')
      const quality = createMockEngine('quality-engine')
      router.setFastEngine(fast)
      router.setQualityEngine(quality)

      const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
      const result = await router.translate(longText, 'en', 'ja')
      expect(result.engineId).toBe('quality-engine')
    })

    it('falls back to fast engine when quality is not available', async () => {
      const fast = createMockEngine('fast-engine')
      router.setFastEngine(fast)
      // quality engine not set

      const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
      const result = await router.translate(longText, 'en', 'ja')
      expect(result.engineId).toBe('fast-engine')
    })

    it('falls back to quality engine when fast is not available', async () => {
      const quality = createMockEngine('quality-engine')
      router.setQualityEngine(quality)
      // fast engine not set

      const result = await router.translate('Hello', 'en', 'ja')
      expect(result.engineId).toBe('quality-engine')
    })

    it('throws when no engines are available', async () => {
      await expect(router.translate('Hello', 'en', 'ja'))
        .rejects.toThrow('No translation engine available')
    })

    it('passes context to the selected engine', async () => {
      const fast = createMockEngine('fast-engine')
      router.setFastEngine(fast)

      const context: TranslateContext = {
        previousSegments: [{ source: 'test', translated: 'テスト' }]
      }
      await router.translate('Hi', 'en', 'ja', context)
      expect(fast.translate).toHaveBeenCalledWith('Hi', 'en', 'ja', context)
    })
  })

  // --- Telemetry ---

  describe('telemetry', () => {
    it('records routing decisions', async () => {
      const fast = createMockEngine('fast-engine', 1)
      router.setFastEngine(fast)
      router.setQualityEngine(createMockEngine('quality-engine', 1))

      await router.translate('Hello', 'en', 'ja')
      await router.translate('World', 'en', 'ja')

      const telemetry = router.getTelemetry()
      expect(telemetry).toHaveLength(2)
      expect(telemetry[0].tier).toBe('fast')
      expect(telemetry[0].engineId).toBe('fast-engine')
      expect(telemetry[0].latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('provides summary statistics', async () => {
      const fast = createMockEngine('fast-engine', 1)
      const quality = createMockEngine('quality-engine', 1)
      router.setFastEngine(fast)
      router.setQualityEngine(quality)

      await router.translate('Hi', 'en', 'ja')
      const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
      await router.translate(longText, 'en', 'ja')

      const summary = router.getTelemetrySummary()
      expect(summary.totalRequests).toBe(2)
      expect(summary.fastCount).toBe(1)
      expect(summary.qualityCount).toBe(1)
    })

    it('truncates source text for privacy', async () => {
      const fast = createMockEngine('fast-engine', 1)
      router.setFastEngine(fast)

      const longText = 'x'.repeat(200)
      await router.translate(longText, 'en', 'ja')

      const telemetry = router.getTelemetry()
      expect(telemetry[0].sourceText.length).toBeLessThanOrEqual(100)
    })

    it('evicts old entries when over limit', async () => {
      const fast = createMockEngine('fast-engine', 0)
      router.setFastEngine(fast)
      // Set a low limit for testing
      ;(router as unknown as { maxTelemetryEntries: number }).maxTelemetryEntries = 5

      for (let i = 0; i < 10; i++) {
        await router.translate(`msg${i}`, 'en', 'ja')
      }

      expect(router.getTelemetry()).toHaveLength(5)
    })

    it('clearTelemetry resets log', async () => {
      const fast = createMockEngine('fast-engine', 1)
      router.setFastEngine(fast)
      await router.translate('Hi', 'en', 'ja')

      router.clearTelemetry()
      expect(router.getTelemetry()).toHaveLength(0)
    })

    it('summary returns zeros when empty', () => {
      const summary = router.getTelemetrySummary()
      expect(summary.totalRequests).toBe(0)
      expect(summary.fastCount).toBe(0)
      expect(summary.qualityCount).toBe(0)
      expect(summary.avgFastLatencyMs).toBe(0)
      expect(summary.avgQualityLatencyMs).toBe(0)
    })
  })

  // --- isReady ---

  describe('isReady', () => {
    it('returns false when no engines are set', () => {
      expect(router.isReady).toBe(false)
    })

    it('returns false with only fast engine', () => {
      router.setFastEngine(createMockEngine('fast'))
      expect(router.isReady).toBe(false)
    })

    it('returns true with both engines', () => {
      router.setFastEngine(createMockEngine('fast'))
      router.setQualityEngine(createMockEngine('quality'))
      expect(router.isReady).toBe(true)
    })
  })

  // --- dispose ---

  describe('dispose', () => {
    it('clears engine references and telemetry', async () => {
      router.setFastEngine(createMockEngine('fast'))
      router.setQualityEngine(createMockEngine('quality'))
      router.setGlossary([{ source: 'test', target: 'test' }])

      await router.dispose()

      expect(router.isReady).toBe(false)
      expect(router.getTelemetry()).toHaveLength(0)
    })
  })

  // --- Japanese text ---

  describe('Japanese text routing', () => {
    it('counts CJK characters as individual tokens', () => {
      // 7 characters → below shortThreshold of 10
      const result = router.scoreComplexity('こんにちは世界')
      expect(result.tokenCount).toBe(7)
      expect(result.tier).toBe('fast')
    })

    it('routes long Japanese text to quality', () => {
      // 50+ characters should go quality
      const longJa = 'あ'.repeat(55)
      const result = router.scoreComplexity(longJa)
      expect(result.tier).toBe('quality')
    })
  })
})
