import { describe, it, expect } from 'vitest'
import { CascadeShadowPath } from './CascadeShadowPath'
import type { Language, STTEngine, STTResult, TranslatorEngine } from '../../../engines/types'

function stt(result: STTResult | null, isOffline = true): STTEngine {
  return {
    id: 'mock-stt',
    name: 'Mock STT',
    isOffline,
    initialize: async () => undefined,
    processAudio: async () => result,
    dispose: async () => undefined
  }
}

function translator(
  translate: (text: string, from: Language, to: Language) => Promise<string>,
  isOffline = true
): TranslatorEngine {
  return {
    id: 'mock-mt',
    name: 'Mock MT',
    isOffline,
    initialize: async () => undefined,
    translate: async (text, from, to) => translate(text, from, to),
    dispose: async () => undefined
  }
}

function sttResult(text: string, language: Language): STTResult {
  return { text, language, isFinal: true, timestamp: 0 }
}

const AUDIO = new Float32Array(1600)

describe('CascadeShadowPath', () => {
  it('runs STT then MT and reports the final line as its first subtitle', async () => {
    const path = new CascadeShadowPath({
      stt: stt(sttResult('おはようございます', 'ja')),
      translator: translator(async () => 'Good morning')
    })

    const result = await path.process(AUDIO, 16000, new AbortController().signal)

    expect(result.sourceText).toBe('おはようございます')
    expect(result.translatedText).toBe('Good morning')
    // A batch cascade never revises, and its only subtitle is its final one.
    expect(result.revisionCount).toBe(0)
    expect(result.firstSubtitleMs).toBeGreaterThanOrEqual(0)
  })

  it('translates JA to EN and EN to JA based on the detected language', async () => {
    const seen: Array<{ from: Language; to: Language }> = []
    const make = (language: Language): CascadeShadowPath =>
      new CascadeShadowPath({
        stt: stt(sttResult('text', language)),
        translator: translator(async (_t, from, to) => {
          seen.push({ from, to })
          return 'out'
        })
      })

    await make('ja').process(AUDIO, 16000, new AbortController().signal)
    await make('en').process(AUDIO, 16000, new AbortController().signal)

    expect(seen).toEqual([
      { from: 'ja', to: 'en' },
      { from: 'en', to: 'ja' }
    ])
  })

  it('falls back to the default source language when STT reports outside JA/EN', async () => {
    const seen: Array<{ from: Language; to: Language }> = []
    const path = new CascadeShadowPath({
      stt: stt(sttResult('text', 'zh')),
      translator: translator(async (_t, from, to) => {
        seen.push({ from, to })
        return 'out'
      }),
      defaultSourceLanguage: 'ja'
    })

    await path.process(AUDIO, 16000, new AbortController().signal)

    expect(seen).toEqual([{ from: 'ja', to: 'en' }])
  })

  it('returns an empty sample without translating when STT finds no speech', async () => {
    let translateCalls = 0
    const path = new CascadeShadowPath({
      stt: stt(null),
      translator: translator(async () => {
        translateCalls++
        return 'should not happen'
      })
    })

    const result = await path.process(AUDIO, 16000, new AbortController().signal)

    expect(result).toEqual({
      sourceText: '',
      translatedText: '',
      firstSubtitleMs: null,
      revisionCount: 0
    })
    expect(translateCalls).toBe(0)
  })

  it('treats whitespace-only STT output as no speech', async () => {
    const path = new CascadeShadowPath({
      stt: stt(sttResult('   ', 'ja')),
      translator: translator(async () => 'should not happen')
    })

    const result = await path.process(AUDIO, 16000, new AbortController().signal)

    expect(result.sourceText).toBe('')
    expect(result.translatedText).toBe('')
  })

  it('is offline only when both stages are offline', () => {
    const offlineStt = stt(sttResult('t', 'ja'), true)
    const cloudMt = translator(async () => 'x', false)
    const offlineMt = translator(async () => 'x', true)

    expect(new CascadeShadowPath({ stt: offlineStt, translator: offlineMt }).isOffline).toBe(true)
    // A cloud MT stage sends the transcript off-device even behind offline STT.
    expect(new CascadeShadowPath({ stt: offlineStt, translator: cloudMt }).isOffline).toBe(false)
    expect(new CascadeShadowPath({ stt: stt(sttResult('t', 'ja'), false), translator: offlineMt }).isOffline).toBe(false)
  })

  it('rejects when aborted before the translation stage', async () => {
    const controller = new AbortController()
    const path = new CascadeShadowPath({
      stt: {
        ...stt(sttResult('text', 'ja')),
        processAudio: async () => {
          controller.abort()
          return sttResult('text', 'ja')
        }
      },
      translator: translator(async () => 'should not happen')
    })

    await expect(path.process(AUDIO, 16000, controller.signal)).rejects.toThrow()
  })

  it('derives an id from its two stages and defaults to zero cost', () => {
    const path = new CascadeShadowPath({
      stt: stt(sttResult('t', 'ja')),
      translator: translator(async () => 'x')
    })

    expect(path.id).toBe('cascade:mock-stt+mock-mt')
    expect(path.kind).toBe('cascade')
    expect(path.cost).toEqual({})
  })
})
