import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiRotationController } from './ApiRotationController'
import type { TranslatorEngine, Language } from '../types'
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
    ;(engine1.translate as any).mockRejectedValue(new Error('API error'))
    await controller.initialize()

    const result = await controller.translate('hello', 'en', 'ja')
    expect(result).toBe('result-b')
  })

  it('throws when all providers fail', async () => {
    ;(engine1.translate as any).mockRejectedValue(new Error('fail-a'))
    ;(engine2.translate as any).mockRejectedValue(new Error('fail-b'))
    await controller.initialize()

    await expect(controller.translate('hello', 'en', 'ja')).rejects.toThrow('All translation providers exhausted')
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
