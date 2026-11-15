import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranslationPipeline } from './TranslationPipeline'
import type {
  STTEngine,
  STTResult,
  TranslatorEngine,
  E2ETranslationEngine,
  TranslationResult
} from '../engines/types'

function makeResult(source: string, translated: string): TranslationResult {
  return {
    sourceText: source,
    translatedText: translated,
    sourceLanguage: 'en',
    targetLanguage: 'ja',
    timestamp: Date.now()
  }
}

class MockE2EEngine implements E2ETranslationEngine {
  readonly isOffline = true
  disposed = false

  constructor(readonly id: string, readonly name = id) {}

  async initialize(): Promise<void> {}
  async processAudio(): Promise<TranslationResult | null> {
    return null
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

class MockSTT implements STTEngine {
  readonly isOffline = true
  constructor(
    readonly id: string,
    private readonly result: STTResult | null,
    readonly name = id
  ) {}
  async initialize(): Promise<void> {}
  async processAudio(): Promise<STTResult | null> {
    return this.result
  }
  async dispose(): Promise<void> {}
}

class MockTranslator implements TranslatorEngine {
  readonly isOffline = true
  translateCalls: string[] = []
  pending: { resolve: (value: string) => void } | null = null

  constructor(
    readonly id: string,
    private readonly mode: 'immediate' | 'deferred' = 'immediate',
    readonly name = id
  ) {}

  async initialize(): Promise<void> {}

  async translate(text: string): Promise<string> {
    this.translateCalls.push(text)
    if (this.mode === 'deferred') {
      return new Promise<string>((resolve) => {
        this.pending = { resolve }
      })
    }
    return `T(${text})`
  }

  async dispose(): Promise<void> {}
}

describe('TranslationPipeline engine switching (#719)', () => {
  it('does not emit stale cascade translations after switching to e2e', async () => {
    vi.useFakeTimers()
    try {
      const pipeline = new TranslationPipeline()
      const stt = new MockSTT('stt', {
        text: 'hello world',
        language: 'en',
        isFinal: false,
        timestamp: Date.now()
      })
      const translator = new MockTranslator('tr', 'deferred')
      const e2e = new MockE2EEngine('e2e')
      pipeline.registerSTT('stt', () => stt)
      pipeline.registerTranslator('tr', () => translator)
      pipeline.registerE2E('e2e', () => e2e)

      await pipeline.switchEngine({ mode: 'cascade', sttEngineId: 'stt', translatorEngineId: 'tr' })
      pipeline.start()

      const translated: TranslationResult[] = []
      const collect = (r: TranslationResult) => {
        if (r.translatedText) translated.push(r)
      }
      pipeline.on('interim-result', collect)
      pipeline.on('result', collect)

      // Schedule a debounced streaming translation.
      const speech = new Float32Array(16000).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / 16000))
      await pipeline.processStreaming(speech, 16000, 's1')
      // Fire the debounce timer so translate() is invoked and left in flight.
      vi.advanceTimersByTime(1500)
      expect(translator.translateCalls.length).toBeGreaterThan(0)
      expect(translator.pending).not.toBeNull()

      // Switch engines while the translation promise is still pending.
      await pipeline.switchEngine({ mode: 'e2e', e2eEngineId: 'e2e' })

      // Resolve the now-stale translation.
      translator.pending!.resolve('STALE-TRANSLATION')
      await Promise.resolve()
      await Promise.resolve()

      expect(translated.find((r) => r.translatedText === 'STALE-TRANSLATION')).toBeUndefined()

      await pipeline.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

class RecordingSTT implements STTEngine {
  readonly isOffline = true
  readonly id = 'stt'
  readonly name = 'stt'
  contexts: string[] = []
  constructor(private readonly text: string) {}
  async initialize(): Promise<void> {}
  setContext(context: string): void {
    this.contexts.push(context)
  }
  async processAudio(): Promise<STTResult | null> {
    return { text: this.text, language: 'ja', isFinal: true, timestamp: Date.now() }
  }
  async dispose(): Promise<void> {}
}

describe('TranslationPipeline glossary at the ASR stage', () => {
  const speech = new Float32Array(16000).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / 16000))

  async function startWith(stt: RecordingSTT, translator: MockTranslator): Promise<TranslationPipeline> {
    const pipeline = new TranslationPipeline()
    pipeline.registerSTT('stt', () => stt)
    pipeline.registerTranslator('tr', () => translator)
    await pipeline.switchEngine({ mode: 'cascade', sttEngineId: 'stt', translatorEngineId: 'tr' })
    pipeline.start()
    return pipeline
  }

  it('gives the terms to STT and corrects aliases before translation', async () => {
    const stt = new RecordingSTT('アビーの新機能です')
    const translator = new MockTranslator('tr')
    const pipeline = await startWith(stt, translator)
    pipeline.setGlossary([{ source: 'アビィ', target: 'Avvy', aliases: ['アビー'] }])

    const result = await pipeline.finalizeStreaming(speech, 16000, 's1')

    expect(stt.contexts.at(-1)).toBe('アビィ, Avvy')
    expect(result?.sourceText).toBe('アビィの新機能です')
    expect(translator.translateCalls.at(-1)).toBe('アビィの新機能です')
    await pipeline.dispose()
  })

  it('applies a glossary edit from the next utterance without a restart', async () => {
    const stt = new RecordingSTT('アビーの新機能です')
    const translator = new MockTranslator('tr')
    const pipeline = await startWith(stt, translator)

    const before = await pipeline.finalizeStreaming(speech, 16000, 's1')
    pipeline.setGlossary([{ source: 'アビィ', target: 'Avvy', aliases: ['アビー'] }])
    const after = await pipeline.finalizeStreaming(speech, 16000, 's2')

    expect(before?.sourceText).toBe('アビーの新機能です')
    expect(stt.contexts[0]).toBe('')
    expect(after?.sourceText).toBe('アビィの新機能です')
    expect(stt.contexts.at(-1)).toBe('アビィ, Avvy')
    await pipeline.dispose()
  })

  it('does not cache a translation made under a glossary replaced meanwhile', async () => {
    const stt = new RecordingSTT('新機能です')
    const translator = new MockTranslator('tr', 'deferred')
    const pipeline = await startWith(stt, translator)
    const translateOnce = async (value: string): Promise<void> => {
      await vi.waitFor(() => expect(translator.pending).not.toBeNull())
      const pending = translator.pending
      translator.pending = null
      pending?.resolve(value)
    }
    pipeline.setGlossary([{ source: 'アビィ', target: 'Avvy' }])

    const first = pipeline.finalizeStreaming(speech, 16000, 's1')
    await vi.waitFor(() => expect(translator.pending).not.toBeNull())
    pipeline.setGlossary([{ source: 'アビィ', target: 'Abby' }])
    await translateOnce('old')
    await first

    const second = pipeline.finalizeStreaming(speech, 16000, 's2')
    await translateOnce('new')

    expect((await second)?.translatedText).toBe('new')
    expect(translator.translateCalls).toHaveLength(2)
    await pipeline.dispose()
  })
})
