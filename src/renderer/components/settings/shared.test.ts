import { describe, it, expect } from 'vitest'
import { buildEngineConfig, resolveEngineMode, getEngineDisplayName, LEGACY_TRANSLATION_ENGINES, LLM_ENGINE_MODES } from './shared'
import type { EngineMode, SttEngineType } from './shared'

const STT: SttEngineType = 'mlx-whisper'
const CLOUD_MODES = ['rotation', 'online', 'online-deepl', 'online-gemini']

describe('EngineMode catalog', () => {
  it('LEGACY_TRANSLATION_ENGINES lists the IDs removed from the UI, including every cloud mode', () => {
    expect(LEGACY_TRANSLATION_ENGINES).toEqual(
      expect.arrayContaining(['offline-lfm2', 'offline-plamo', 'offline-hybrid', 'offline-opus', ...CLOUD_MODES])
    )
    expect(LEGACY_TRANSLATION_ENGINES).toHaveLength(8)
  })

  it('LLM_ENGINE_MODES only retains the two supported LLM engines', () => {
    expect(LLM_ENGINE_MODES).toEqual(['offline-hymt15', 'offline-hunyuan-mt'])
  })

  it('getEngineDisplayName returns the raw mode string for unknown legacy IDs', () => {
    for (const legacy of LEGACY_TRANSLATION_ENGINES) {
      expect(getEngineDisplayName(legacy as EngineMode)).toBe(legacy)
    }
  })

  it('getEngineDisplayName names the on-device engines', () => {
    expect(getEngineDisplayName('offline-hymt15')).toContain('HY-MT')
    expect(getEngineDisplayName('auto')).toBe('Auto')
  })
})

describe('resolveEngineMode', () => {
  it('returns an explicit mode unchanged', () => {
    expect(resolveEngineMode('offline-apple', null)).toBe('offline-apple')
    expect(resolveEngineMode('offline-hunyuan-mt', { hasGpu: false })).toBe('offline-hunyuan-mt')
  })

  it('auto resolves to HY-MT 1.5 without a GPU or GPU info', () => {
    expect(resolveEngineMode('auto', null)).toBe('offline-hymt15')
    expect(resolveEngineMode('auto', { hasGpu: false })).toBe('offline-hymt15')
  })

  it('auto resolves to Hunyuan-MT 7B with a GPU', () => {
    expect(resolveEngineMode('auto', { hasGpu: true })).toBe('offline-hunyuan-mt')
  })

  it('auto never resolves to a cloud mode', () => {
    for (const gpu of [null, { hasGpu: false }, { hasGpu: true }]) {
      expect(CLOUD_MODES).not.toContain(resolveEngineMode('auto', gpu))
    }
  })
})

describe('buildEngineConfig', () => {
  it.each([
    ['offline-hymt15', 'hunyuan-mt-15'],
    ['offline-hunyuan-mt', 'hunyuan-mt'],
    ['offline-apple', 'apple-translate']
  ] as const)('maps %s to the %s translator in cascade mode', (mode, translator) => {
    expect(buildEngineConfig(mode, STT)).toEqual({ mode: 'cascade', sttEngineId: STT, translatorEngineId: translator })
  })

  it('falls back to HY-MT 1.5 for unknown legacy IDs and never carries credentials', () => {
    for (const legacy of LEGACY_TRANSLATION_ENGINES) {
      const config = buildEngineConfig(legacy as EngineMode, STT)
      expect(config).toEqual({ mode: 'cascade', sttEngineId: STT, translatorEngineId: 'hunyuan-mt-15' })
    }
  })
})
