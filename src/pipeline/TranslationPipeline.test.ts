import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranslationPipeline } from './TranslationPipeline'
import type {
  STTEngine,
  STTResult,
  TranslatorEngine,
  E2ETranslationEngine,
  TranslationResult
} from '../engines/types'

// GERProcessor transitively imports the Electron-backed worker pool; stub it so the
// pipeline can be exercised in a plain Node test environment. GER stays disabled here.
vi.mock('../main/worker-pool', () => ({
  workerPool: { isAlive: false, sendRequest: vi.fn() }
}))

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
      await pipeline.processStreaming(new Float32Array(16000), 16000)
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
