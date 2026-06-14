import { describe, it, expect, vi } from 'vitest'
import { migrateLegacyTranslationEngine, LEGACY_TRANSLATION_ENGINES } from './store-migrations'
import type { MigratableStore } from './store-migrations'

/** Build an in-memory mock store seeded with a translationEngine value */
function mockStore(initial: unknown): { store: MigratableStore; getCurrent: () => unknown; setCalls: number } {
  let value: unknown = initial
  let setCalls = 0
  return {
    store: {
      get: (_key) => value,
      set: (_key, next) => {
        value = next
        setCalls++
      }
    },
    getCurrent: () => value,
    get setCalls() { return setCalls }
  }
}

describe('migrateLegacyTranslationEngine (#702)', () => {
  it.each(LEGACY_TRANSLATION_ENGINES)(
    'rewrites legacy ID "%s" to "auto" and logs the migration',
    (legacy) => {
      const fixture = mockStore(legacy)
      const logger = { info: vi.fn() }

      const migrated = migrateLegacyTranslationEngine(fixture.store, logger)

      expect(migrated).toBe(true)
      expect(fixture.getCurrent()).toBe('auto')
      expect(logger.info).toHaveBeenCalledOnce()
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`from "${legacy}" to "auto"`)
      )
    }
  )

  it('leaves supported engine IDs untouched', () => {
    for (const supported of ['auto', 'offline-hymt15', 'offline-hunyuan-mt', 'offline-apple', 'rotation', 'online']) {
      const fixture = mockStore(supported)
      const migrated = migrateLegacyTranslationEngine(fixture.store)
      expect(migrated).toBe(false)
      expect(fixture.getCurrent()).toBe(supported)
    }
  })

  it('does nothing when the stored value is missing or not a string', () => {
    for (const empty of [undefined, null, 0, false, {}]) {
      const fixture = mockStore(empty)
      const migrated = migrateLegacyTranslationEngine(fixture.store)
      expect(migrated).toBe(false)
      expect(fixture.getCurrent()).toBe(empty)
    }
  })

  it('does not call store.set when no migration is needed', () => {
    const fixture = mockStore('offline-hymt15')
    migrateLegacyTranslationEngine(fixture.store)
    expect(fixture.setCalls).toBe(0)
  })

  it('works without a logger', () => {
    const fixture = mockStore('offline-opus')
    expect(() => migrateLegacyTranslationEngine(fixture.store)).not.toThrow()
    expect(fixture.getCurrent()).toBe('auto')
  })
})
