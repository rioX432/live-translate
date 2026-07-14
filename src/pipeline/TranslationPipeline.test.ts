import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranslationPipeline } from './TranslationPipeline'
import type {
  STTEngine,
  STTResult,
  TranslatorEngine,
  E2ETranslationEngine,
  E2EStreamingSession,
  E2EStreamingSink,
  E2EStreamingStartOptions,
  E2EStreamingStopOptions,
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

class MockStreamingSession implements E2EStreamingSession {
  sink: E2EStreamingSink | null = null
  signal: AbortSignal | null = null
  started = false
  stopped = false
  flushed = 0
  stopFlush: boolean | undefined = undefined

  async start(opts: E2EStreamingStartOptions): Promise<void> {
    this.sink = opts.sink
    this.signal = opts.signal
    this.started = true
  }

  async pushAudio(): Promise<void> {
    // Mock: no automatic emission — the test drives sink output explicitly.
  }

  async flushSegment(): Promise<void> {
    this.flushed++
  }

  async stop(opts?: E2EStreamingStopOptions): Promise<void> {
    this.stopped = true
    this.stopFlush = opts?.flush
  }
}

class MockE2EStreamingEngine implements E2ETranslationEngine {
  readonly isOffline = true
  session = new MockStreamingSession()
  disposed = false

  constructor(readonly id: string, readonly name = id) {}

  async initialize(): Promise<void> {}
  async processAudio(): Promise<TranslationResult | null> {
    return null
  }
  createStreamingSession(): E2EStreamingSession {
    return this.session
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

describe('TranslationPipeline e2e streaming path (#719)', () => {
  let pipeline: TranslationPipeline
  let engine: MockE2EStreamingEngine

  beforeEach(async () => {
    pipeline = new TranslationPipeline()
    engine = new MockE2EStreamingEngine('mock-e2e')
    pipeline.registerE2E('mock-e2e', () => engine)
    await pipeline.switchEngine({ mode: 'e2e', e2eEngineId: 'mock-e2e' })
    pipeline.start()
  })

  afterEach(async () => {
    await pipeline.dispose()
  })

  it('starts a session lazily on first realtime audio and forwards sink.interim as interim-result', async () => {
    const interim: TranslationResult[] = []
    pipeline.on('interim-result', (r) => interim.push(r))

    expect(engine.session.started).toBe(false)
    await pipeline.pushRealtimeAudio(new Float32Array(16000))
    expect(engine.session.started).toBe(true)

    engine.session.sink!.interim(makeResult('hello', 'こんにちは'))

    expect(interim).toHaveLength(1)
    expect(interim[0].isInterim).toBe(true)
    expect(interim[0].translatedText).toBe('こんにちは')
  })

  it('forwards sink.final as a result event with isInterim=false', async () => {
    const finals: TranslationResult[] = []
    pipeline.on('result', (r) => finals.push(r))

    await pipeline.pushRealtimeAudio(new Float32Array(16000))
    engine.session.sink!.final(makeResult('hello', 'こんにちは'))

    expect(finals).toHaveLength(1)
    expect(finals[0].isInterim).toBe(false)
    expect(finals[0].translatedText).toBe('こんにちは')
  })

  it('reuses a single session across multiple pushes', async () => {
    await pipeline.pushRealtimeAudio(new Float32Array(16000))
    const first = engine.session
    await pipeline.pushRealtimeAudio(new Float32Array(16000))
    expect(engine.session).toBe(first)
  })

  it('forwards speech boundary to the session flush', async () => {
    await pipeline.pushRealtimeAudio(new Float32Array(16000))
    await pipeline.onSpeechBoundary()
    expect(engine.session.flushed).toBe(1)
  })

  it('is a no-op when not in e2e mode', async () => {
    const cascade = new TranslationPipeline()
    cascade.registerSTT('stt', () => new MockSTT('stt', null))
    cascade.registerTranslator('tr', () => new MockTranslator('tr'))
    await cascade.switchEngine({ mode: 'cascade', sttEngineId: 'stt', translatorEngineId: 'tr' })
    cascade.start()
    // Must not throw and must not create a session.
    await expect(cascade.pushRealtimeAudio(new Float32Array(16000))).resolves.toBeUndefined()
    await cascade.dispose()
  })
})

describe('TranslationPipeline switchEngine reset regression (#719)', () => {
  it('drops results from an e2e session torn down by switchEngine', async () => {
    const pipeline = new TranslationPipeline()
    const engineA = new MockE2EStreamingEngine('e2e-a')
    const engineB = new MockE2EStreamingEngine('e2e-b')
    pipeline.registerE2E('e2e-a', () => engineA)
    pipeline.registerE2E('e2e-b', () => engineB)

    await pipeline.switchEngine({ mode: 'e2e', e2eEngineId: 'e2e-a' })
    pipeline.start()

    const emitted: TranslationResult[] = []
    pipeline.on('interim-result', (r) => emitted.push(r))
    pipeline.on('result', (r) => emitted.push(r))

    await pipeline.pushRealtimeAudio(new Float32Array(16000))
    const staleSink = engineA.session.sink!

    await pipeline.switchEngine({ mode: 'e2e', e2eEngineId: 'e2e-b' })

    // Late emissions from the previous (aborted) session must be dropped.
    staleSink.interim(makeResult('stale', 'stale'))
    staleSink.final(makeResult('stale', 'stale'))

    expect(emitted).toHaveLength(0)
    expect(engineA.session.stopped).toBe(true)
    await pipeline.dispose()
  })

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
      const e2e = new MockE2EStreamingEngine('e2e')
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
