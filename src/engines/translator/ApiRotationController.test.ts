import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiRotationController } from './ApiRotationController'
import type { TranslatorEngine } from '../types'
import type { ProviderConfig, QuotaPersistence, QuotaStore } from './ApiRotationController'

function createMockEngine(id: string, result = 'translated'): TranslatorEngine {
  return {
    id,
    name: `Mock ${id}`,
    isOffline: false,
    initialize: vi.fn(async () => {}),
    translate: vi.fn(async () => result),
    dispose: vi.fn(async () => {})
  }
}

function createMockPersistence(): QuotaPersistence & { store: QuotaStore } {
  const store: QuotaStore = {}
  return {
    store,
    load: () => store,
    save: (q) => Object.assign(store, q)
  }
}

describe('ApiRotationController', () => {
  let controller: ApiRotationController
  let engine1: TranslatorEngine
  let engine2: TranslatorEngine
  let persistence: ReturnType<typeof createMockPersistence>

  beforeEach(() => {
    engine1 = createMockEngine('provider-a', 'result-a')
    engine2 = createMockEngine('provider-b', 'result-b')
    persistence = createMockPersistence()

    const providers: ProviderConfig[] = [
      { engine: engine1, monthlyCharLimit: 100 },
      { engine: engine2, monthlyCharLimit: 200 }
    ]

    controller = new ApiRotationController(providers, persistence)
  })

  it('initializes all providers', async () => {
    await controller.initialize()
    expect(engine1.initialize).toHaveBeenCalled()
    expect(engine2.initialize).toHaveBeenCalled()
  })

  it('uses first provider by default', async () => {
    await controller.initialize()
    const result = await controller.translate('hello', 'en', 'ja')
    expect(result).toBe('result-a')
    expect(engine1.translate).toHaveBeenCalled()
  })

  it('falls back to second provider when first exceeds quota', async () => {
    // Exhaust provider-a quota
    const month = new Date()
    const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    persistence.store['provider-a'] = { monthKey, charCount: 100 }

    controller = new ApiRotationController(
      [
        { engine: engine1, monthlyCharLimit: 100 },
        { engine: engine2, monthlyCharLimit: 200 }
      ],
      persistence
    )
    await controller.initialize()

    const result = await controller.translate('hello', 'en', 'ja')
    expect(result).toBe('result-b')
  })

  it('falls back when first provider throws', async () => {
    vi.mocked(engine1.translate).mockRejectedValue(new Error('API error'))
    await controller.initialize()

    const result = await controller.translate('hello', 'en', 'ja')
    expect(result).toBe('result-b')
  })

  it('throws when all providers fail', async () => {
    vi.mocked(engine1.translate).mockRejectedValue(new Error('fail-a'))
    vi.mocked(engine2.translate).mockRejectedValue(new Error('fail-b'))
    await controller.initialize()

    await expect(controller.translate('hello', 'en', 'ja')).rejects.toThrow('All translation providers exhausted')
  })

  describe('#703 fallbackEngine', () => {
    it('falls back to local engine when all providers are exhausted', async () => {
      const fallback = createMockEngine('local-fallback', 'local-result')
      ;(fallback as { isOffline: boolean }).isOffline = true
      vi.mocked(engine1.translate).mockRejectedValue(new Error('fail-a'))
      vi.mocked(engine2.translate).mockRejectedValue(new Error('fail-b'))

      const c = new ApiRotationController(
        [
          { engine: engine1, monthlyCharLimit: 100 },
          { engine: engine2, monthlyCharLimit: 200 }
        ],
        persistence,
        undefined,
        { fallbackEngine: fallback }
      )
      await c.initialize()

      const result = await c.translate('hello', 'en', 'ja')
      expect(result).toBe('local-result')
      expect(fallback.initialize).toHaveBeenCalledTimes(1)
      expect(fallback.translate).toHaveBeenCalledWith('hello', 'en', 'ja', undefined)
    })

    it('lazy-initializes fallback engine only once across multiple exhaustions', async () => {
      const fallback = createMockEngine('local-fallback', 'local-result')
      vi.mocked(engine1.translate).mockRejectedValue(new Error('Quota exceeded'))
      vi.mocked(engine2.translate).mockRejectedValue(new Error('Quota exceeded'))

      const c = new ApiRotationController(
        [
          { engine: engine1, monthlyCharLimit: 100 },
          { engine: engine2, monthlyCharLimit: 200 }
        ],
        persistence,
        undefined,
        { fallbackEngine: fallback }
      )
      await c.initialize()

      await c.translate('hello', 'en', 'ja')
      await c.translate('world', 'en', 'ja')

      expect(fallback.initialize).toHaveBeenCalledTimes(1)
      expect(fallback.translate).toHaveBeenCalledTimes(2)
    })

    it('still throws when no fallbackEngine is configured (backward-compat)', async () => {
      vi.mocked(engine1.translate).mockRejectedValue(new Error('fail-a'))
      vi.mocked(engine2.translate).mockRejectedValue(new Error('fail-b'))

      const c = new ApiRotationController(
        [
          { engine: engine1, monthlyCharLimit: 100 },
          { engine: engine2, monthlyCharLimit: 200 }
        ],
        persistence
      )
      await c.initialize()

      await expect(c.translate('hello', 'en', 'ja')).rejects.toThrow(
        'All translation providers exhausted'
      )
    })

    it('disposes fallbackEngine when initialized', async () => {
      const fallback = createMockEngine('local-fallback', 'local-result')
      vi.mocked(engine1.translate).mockRejectedValue(new Error('fail-a'))
      vi.mocked(engine2.translate).mockRejectedValue(new Error('fail-b'))

      const c = new ApiRotationController(
        [
          { engine: engine1, monthlyCharLimit: 100 },
          { engine: engine2, monthlyCharLimit: 200 }
        ],
        persistence,
        undefined,
        { fallbackEngine: fallback }
      )
      await c.initialize()
      await c.translate('hello', 'en', 'ja')
      await c.dispose()

      expect(fallback.dispose).toHaveBeenCalledTimes(1)
    })

    it('does NOT dispose fallbackEngine if it was never initialized', async () => {
      const fallback = createMockEngine('local-fallback', 'local-result')

      const c = new ApiRotationController(
        [
          { engine: engine1, monthlyCharLimit: 100 },
          { engine: engine2, monthlyCharLimit: 200 }
        ],
        persistence,
        undefined,
        { fallbackEngine: fallback }
      )
      await c.initialize()
      await c.translate('hello', 'en', 'ja') // succeeds via engine1
      await c.dispose()

      expect(fallback.initialize).not.toHaveBeenCalled()
      expect(fallback.dispose).not.toHaveBeenCalled()
    })
  })

  describe('#703 429 classification', () => {
    it('applies short cooldown on Rate limit (default 60s)', async () => {
      vi.useFakeTimers()
      try {
        vi.mocked(engine1.translate)
          .mockRejectedValueOnce(new Error('Rate limit - retry after short cooldown'))
          .mockResolvedValueOnce('result-a')
        await controller.initialize()

        const result1 = await controller.translate('hello', 'en', 'ja')
        expect(result1).toBe('result-b') // falls through to engine2
        expect(engine1.translate).toHaveBeenCalledTimes(1)

        // Within cooldown — engine1 must be skipped
        const result2 = await controller.translate('world', 'en', 'ja')
        expect(result2).toBe('result-b')
        expect(engine1.translate).toHaveBeenCalledTimes(1)

        // After cooldown — engine1 retried
        vi.advanceTimersByTime(61_000)
        const result3 = await controller.translate('again', 'en', 'ja')
        expect(result3).toBe('result-a')
        expect(engine1.translate).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('honors shortFailureCooldownMs override', async () => {
      vi.useFakeTimers()
      try {
        const c = new ApiRotationController(
          [
            { engine: engine1, monthlyCharLimit: 100 },
            { engine: engine2, monthlyCharLimit: 200 }
          ],
          persistence,
          undefined,
          { shortFailureCooldownMs: 5_000 }
        )
        vi.mocked(engine1.translate)
          .mockRejectedValueOnce(new Error('Rate limit'))
          .mockResolvedValueOnce('result-a')
        await c.initialize()

        await c.translate('hello', 'en', 'ja')
        vi.advanceTimersByTime(4_000)
        await c.translate('world', 'en', 'ja') // still cooled
        expect(engine1.translate).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(2_000)
        await c.translate('again', 'en', 'ja') // 6s elapsed → retried
        expect(engine1.translate).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('marks provider exhausted on Quota exceeded', async () => {
      vi.mocked(engine1.translate).mockRejectedValueOnce(
        new Error('Quota exceeded - monthly limit reached')
      )
      await controller.initialize()

      await controller.translate('hello', 'en', 'ja') // falls through to engine2

      const summary = controller.getQuotaSummary()
      const a = summary.find((s) => s.id === 'provider-a')!
      expect(a.exhausted).toBe(true)
      expect(a.used).toBe(100)
    })

    it('rate-limit errors do NOT count toward MAX_CONSECUTIVE_FAILURES budget', async () => {
      // 5 rate-limit failures should not trigger the 5-minute disable
      vi.mocked(engine1.translate).mockRejectedValue(new Error('Rate limit'))
      await controller.initialize()

      for (let i = 0; i < 5; i++) {
        await controller.translate(`text-${i}`, 'en', 'ja') // falls through
      }
      // engine1 was called once (subsequent attempts skipped by rate-limit cooldown)
      expect(engine1.translate).toHaveBeenCalledTimes(1)
    })
  })

  it('tracks character usage', async () => {
    await controller.initialize()
    await controller.translate('hello', 'en', 'ja') // 5 chars

    const summary = controller.getQuotaSummary()
    expect(summary[0]!.used).toBe(5)
  })

  it('returns empty for empty text', async () => {
    await controller.initialize()
    const result = await controller.translate('', 'en', 'ja')
    expect(result).toBe('')
  })

  it('disposes all providers', async () => {
    await controller.initialize()
    await controller.dispose()
    expect(engine1.dispose).toHaveBeenCalled()
    expect(engine2.dispose).toHaveBeenCalled()
  })
})
