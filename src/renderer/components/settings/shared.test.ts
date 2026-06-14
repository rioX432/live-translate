import { describe, it, expect } from 'vitest'
import { buildEngineConfig, resolveEngineMode, getEngineDisplayName, LEGACY_TRANSLATION_ENGINES, LLM_ENGINE_MODES, API_ENGINE_MODES } from './shared'
import type { EngineMode, SttEngineType } from './shared'

const STT: SttEngineType = 'mlx-whisper'
const NO_KEYS = { apiKey: '', deeplApiKey: '', geminiApiKey: '', microsoftApiKey: '', microsoftRegion: '' }
const ALL_KEYS = { apiKey: 'g', deeplApiKey: 'd', geminiApiKey: 'gem', microsoftApiKey: 'm', microsoftRegion: 'eastus' }

describe('EngineMode catalog (#702)', () => {
  it('LEGACY_TRANSLATION_ENGINES lists the four IDs removed from the UI', () => {
    expect(LEGACY_TRANSLATION_ENGINES).toEqual(
      expect.arrayContaining(['offline-lfm2', 'offline-plamo', 'offline-hybrid', 'offline-opus'])
    )
    expect(LEGACY_TRANSLATION_ENGINES).toHaveLength(4)
  })

  it('LLM_ENGINE_MODES only retains the two supported LLM engines', () => {
    expect(LLM_ENGINE_MODES).toEqual(['offline-hymt15', 'offline-hunyuan-mt'])
  })

  it('API_ENGINE_MODES still lists every online provider mode', () => {
    expect(API_ENGINE_MODES).toEqual(['rotation', 'online', 'online-deepl', 'online-gemini'])
  })

  it('getEngineDisplayName returns the raw mode string for unknown legacy IDs', () => {
    // Legacy IDs are no longer in the union, so callers casting through `as EngineMode`
    // should fall through the switch default and receive the raw string.
    for (const legacy of LEGACY_TRANSLATION_ENGINES) {
      expect(getEngineDisplayName(legacy as EngineMode)).toBe(legacy)
    }
  })
})

describe('buildEngineConfig (#702)', () => {
  it('returns HY-MT 1.5 config for the default offline mode', () => {
    expect(buildEngineConfig('offline-hymt15', STT, NO_KEYS)).toEqual({
      mode: 'cascade',
      sttEngineId: STT,
      translatorEngineId: 'hunyuan-mt-15'
    })
  })

  it('returns Hunyuan-MT 7B config for offline-hunyuan-mt', () => {
    expect(buildEngineConfig('offline-hunyuan-mt', STT, NO_KEYS)).toEqual({
      mode: 'cascade',
      sttEngineId: STT,
      translatorEngineId: 'hunyuan-mt'
    })
  })

  it('returns Apple Translate config for offline-apple', () => {
    expect(buildEngineConfig('offline-apple', STT, NO_KEYS)).toEqual({
      mode: 'cascade',
      sttEngineId: STT,
      translatorEngineId: 'apple-translate'
    })
  })

  it('returns rotation controller with all configured API keys for rotation mode', () => {
    expect(buildEngineConfig('rotation', STT, ALL_KEYS)).toEqual({
      mode: 'cascade',
      sttEngineId: STT,
      translatorEngineId: 'rotation-controller',
      apiKey: 'g',
      deeplApiKey: 'd',
      geminiApiKey: 'gem',
      microsoftApiKey: 'm',
      microsoftRegion: 'eastus'
    })
  })

  it('omits absent API keys from the rotation config', () => {
    const partial = { apiKey: 'g', deeplApiKey: '', geminiApiKey: '', microsoftApiKey: '', microsoftRegion: '' }
    expect(buildEngineConfig('rotation', STT, partial)).toEqual({
      mode: 'cascade',
      sttEngineId: STT,
      translatorEngineId: 'rotation-controller',
      apiKey: 'g'
    })
  })

  it.each(['offline-lfm2', 'offline-plamo', 'offline-hybrid', 'offline-opus'])(
    'falls back to HY-MT 1.5 for removed legacy engine "%s"',
    (legacy) => {
      // Callers may still hold a stale EngineMode string before migration runs;
      // buildEngineConfig must safely fall through to the default case.
      const cfg = buildEngineConfig(legacy as EngineMode, STT, NO_KEYS)
      expect(cfg).toEqual({
        mode: 'cascade',
        sttEngineId: STT,
        translatorEngineId: 'hunyuan-mt-15'
      })
    }
  )
})

describe('resolveEngineMode (#702)', () => {
  it('resolves auto → rotation when at least one API key is configured', () => {
    expect(resolveEngineMode('auto', ALL_KEYS, { hasGpu: false })).toBe('rotation')
  })

  it('resolves auto → offline-hunyuan-mt when GPU is present and no API keys', () => {
    expect(resolveEngineMode('auto', NO_KEYS, { hasGpu: true })).toBe('offline-hunyuan-mt')
  })

  it('resolves auto → offline-hymt15 when no GPU and no API keys', () => {
    expect(resolveEngineMode('auto', NO_KEYS, { hasGpu: false })).toBe('offline-hymt15')
  })

  it('returns the mode unchanged when not auto', () => {
    expect(resolveEngineMode('offline-hymt15', NO_KEYS, null)).toBe('offline-hymt15')
    expect(resolveEngineMode('offline-apple', NO_KEYS, null)).toBe('offline-apple')
  })

  it('treats Azure as a valid key only when both key and region are present', () => {
    const onlyKey = { ...NO_KEYS, microsoftApiKey: 'm' }
    expect(resolveEngineMode('auto', onlyKey, { hasGpu: false })).toBe('offline-hymt15')
    const withRegion = { ...NO_KEYS, microsoftApiKey: 'm', microsoftRegion: 'eastus' }
    expect(resolveEngineMode('auto', withRegion, { hasGpu: false })).toBe('rotation')
  })
})
