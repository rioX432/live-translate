import { describe, it, expect } from 'vitest'
import { buildEngineConfig, getSttDisplayName, LEGACY_TRANSLATION_ENGINES } from './shared'

const CLOUD_MODES = ['rotation', 'online', 'online-deepl', 'online-gemini']

describe('LEGACY_TRANSLATION_ENGINES', () => {
  it('lists every translation engine ID removed from the app, including every cloud mode', () => {
    expect(LEGACY_TRANSLATION_ENGINES).toEqual(
      expect.arrayContaining([
        'offline-lfm2', 'offline-plamo', 'offline-hybrid', 'offline-opus', ...CLOUD_MODES,
        'offline-hymt15', 'offline-hunyuan-mt', 'offline-apple'
      ])
    )
    expect(LEGACY_TRANSLATION_ENGINES).toHaveLength(11)
  })

  it('never lists auto, the only engine mode left', () => {
    expect(LEGACY_TRANSLATION_ENGINES).not.toContain('auto')
  })
})

describe('getSttDisplayName', () => {
  it('names the engine main runs on each platform', () => {
    expect(getSttDisplayName('qwen3-asr')).toBe('Qwen3-ASR 0.6B')
    expect(getSttDisplayName('whisper-local')).toBe('Whisper large-v3-turbo')
  })
})

describe('buildEngineConfig', () => {
  it.each(['qwen3-asr', 'whisper-local'] as const)('builds a cascade config with the Hy-MT2 translator for %s', (stt) => {
    expect(buildEngineConfig(stt)).toEqual({ mode: 'cascade', sttEngineId: stt, translatorEngineId: 'hy-mt2' })
  })
})
