import { describe, it, expect } from 'vitest'
import { E2EStreamingShadowPath } from './E2EStreamingShadowPath'
import type {
  Backpressure,
  E2EStreamingSession,
  E2EStreamingSink,
  E2EStreamingStartOptions,
  E2ETranslationEngine,
  TranslationResult
} from '../../../engines/types'

function result(sourceText: string, translatedText: string): TranslationResult {
  return {
    sourceText,
    translatedText,
    sourceLanguage: 'ja',
    targetLanguage: 'en',
    timestamp: 0,
    isInterim: false
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Let queued microtasks run so an in-flight process() reaches its first await. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** A scripted session: the test drives interim/final through the captured sink. */
class FakeSession implements E2EStreamingSession {
  sink: E2EStreamingSink | null = null
  signal: AbortSignal | null = null
  startCount = 0
  stopCount = 0
  flushCount = 0
  pushedSamples = 0
  pushedChunks: number[] = []
  backpressureOnce = false
  /** Called after the audio for a segment has been pushed. */
  onFlush: ((sink: E2EStreamingSink) => void) | null = null
  /** Called on each pushed chunk — how a real server responds mid-stream. */
  onPush: ((sink: E2EStreamingSink, chunkIndex: number) => void | Promise<void>) | null = null

  async start(options: E2EStreamingStartOptions): Promise<void> {
    this.startCount++
    this.sink = options.sink
    this.signal = options.signal
  }

  async pushAudio(chunk: Float32Array): Promise<void | Backpressure> {
    const index = this.pushedChunks.length
    this.pushedSamples += chunk.length
    this.pushedChunks.push(chunk.length)
    if (this.sink) await this.onPush?.(this.sink, index)
    if (this.backpressureOnce) {
      this.backpressureOnce = false
      return { drained: Promise.resolve() }
    }
  }

  async flushSegment(): Promise<void> {
    this.flushCount++
    if (this.sink) this.onFlush?.(this.sink)
  }

  async stop(): Promise<void> {
    this.stopCount++
  }
}

function engineWith(session: E2EStreamingSession, isOffline = false): E2ETranslationEngine {
  return {
    id: 'fake-e2e',
    name: 'Fake E2E',
    isOffline,
    initialize: async () => undefined,
    processAudio: async () => null,
    createStreamingSession: () => session,
    dispose: async () => undefined
  }
}

/** No pacing, no sleeps, no trailing silence — deterministic and instant. */
function makePath(
  session: FakeSession,
  overrides: Partial<ConstructorParameters<typeof E2EStreamingShadowPath>[0]> = {}
): E2EStreamingShadowPath {
  return new E2EStreamingShadowPath({
    engine: engineWith(session),
    realtimePacing: false,
    trailingSilenceMs: 0,
    settleMs: 0,
    sleep: async () => undefined,
    ...overrides
  })
}

const AUDIO = new Float32Array(16000) // 1s @ 16kHz

describe('E2EStreamingShadowPath', () => {
  it('maps interims to first-subtitle latency and revision count, and the final to the sample', async () => {
    const session = new FakeSession()
    // Deltas stream back while the audio is still being pushed, as they do live.
    session.onPush = (sink, i) => {
      if (i === 2) sink.interim(result('おはよう', 'Good'))
      if (i === 5) sink.interim(result('おはようございます', 'Good morning'))
    }
    session.onFlush = (sink) => sink.final(result('おはようございます', 'Good morning'))
    const path = makePath(session)

    const sample = await path.process(AUDIO, 16000, new AbortController().signal)

    expect(sample.sourceText).toBe('おはようございます')
    expect(sample.translatedText).toBe('Good morning')
    expect(sample.revisionCount).toBe(2)
    expect(sample.firstSubtitleMs).toBeGreaterThanOrEqual(0)
  })

  it('reuses ONE session across segments so the handshake is not measured per segment', async () => {
    const session = new FakeSession()
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session)

    await path.process(AUDIO, 16000, new AbortController().signal)
    await path.process(AUDIO, 16000, new AbortController().signal)
    await path.process(AUDIO, 16000, new AbortController().signal)

    expect(session.startCount).toBe(1)
  })

  it('warmup opens the session before any segment is measured', async () => {
    const session = new FakeSession()
    const path = makePath(session)

    await path.warmup()

    expect(session.startCount).toBe(1)
  })

  it('forces a segment boundary via flushSegment when the server sends no final', async () => {
    const session = new FakeSession()
    session.onFlush = (sink) => sink.final(result('src', 'flushed'))
    const path = makePath(session)

    const sample = await path.process(AUDIO, 16000, new AbortController().signal)

    expect(session.flushCount).toBe(1)
    expect(sample.translatedText).toBe('flushed')
  })

  it('returns an empty sample when a segment produces no text at all', async () => {
    const session = new FakeSession()
    session.onFlush = () => undefined // nothing accumulated: silence
    const path = makePath(session)

    const sample = await path.process(AUDIO, 16000, new AbortController().signal)

    expect(sample).toEqual({
      sourceText: '',
      translatedText: '',
      firstSubtitleMs: null,
      revisionCount: 0
    })
  })

  it('does not let a stale final from a settled segment resolve the next one', async () => {
    const session = new FakeSession()
    session.onFlush = (sink) => sink.final(result('first', 'first-out'))
    const path = makePath(session)

    const first = await path.process(AUDIO, 16000, new AbortController().signal)
    expect(first.translatedText).toBe('first-out')

    // A late final from the previous turn arrives with no segment in flight.
    session.sink!.final(result('stale', 'stale-out'))

    session.onFlush = (sink) => sink.final(result('second', 'second-out'))
    const second = await path.process(AUDIO, 16000, new AbortController().signal)
    expect(second.translatedText).toBe('second-out')
  })

  it('rejects concurrent segments rather than mis-correlating their finals', async () => {
    const session = new FakeSession()
    const held = deferred<void>()
    // Hold the first segment inside pushAudio so a second call overlaps it.
    session.onPush = async (_sink, i) => {
      if (i === 0) await held.promise
    }
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session)

    const first = path.process(AUDIO, 16000, new AbortController().signal)
    await tick()
    await expect(path.process(AUDIO, 16000, new AbortController().signal)).rejects.toThrow(
      /concurrent segments/
    )

    held.resolve()
    await first
  })

  it('honors backpressure before pushing more audio', async () => {
    const session = new FakeSession()
    session.backpressureOnce = true
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session)

    await path.process(AUDIO, 16000, new AbortController().signal)

    expect(session.pushedSamples).toBe(AUDIO.length)
  })

  it('chunks audio at the realtime cadence of the capture adapter', async () => {
    const session = new FakeSession()
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session, { chunkMs: 100 })

    await path.process(AUDIO, 16000, new AbortController().signal)

    // 1s of 16kHz audio at 100ms/chunk = 10 chunks of 1600 samples.
    expect(session.pushedChunks).toEqual(Array(10).fill(1600))
  })

  it('appends trailing silence so the server gets a pause cue to close the turn', async () => {
    const session = new FakeSession()
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session, { trailingSilenceMs: 500 })

    await path.process(AUDIO, 16000, new AbortController().signal)

    // 500ms @ 16kHz = 8000 samples appended after the utterance.
    expect(session.pushedSamples).toBe(AUDIO.length + 8000)
  })

  it('rejects the in-flight segment when the run is aborted', async () => {
    const session = new FakeSession()
    const controller = new AbortController()
    session.onPush = (_sink, i) => {
      if (i === 2) controller.abort()
    }
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session)

    await expect(path.process(AUDIO, 16000, controller.signal)).rejects.toThrow()
  })

  it('surfaces a session error as a failed segment', async () => {
    const session = new FakeSession()
    session.onPush = (sink, i) => {
      if (i === 2) sink.error(new Error('socket died'))
    }
    session.onFlush = (sink) => sink.final(result('src', 'dst'))
    const path = makePath(session)

    await expect(path.process(AUDIO, 16000, new AbortController().signal)).rejects.toThrow(
      'socket died'
    )
  })

  it('drops the session on a segment timeout so its accumulator cannot poison later segments', async () => {
    const session = new FakeSession()
    session.onFlush = () => undefined
    const path = makePath(session, { settleMs: 10_000, segmentTimeoutMs: -1 })

    await expect(path.process(AUDIO, 16000, new AbortController().signal)).rejects.toThrow(/timed out/)
    expect(session.stopCount).toBe(1)
  })

  it('reports cloud descriptors and rejects engines without streaming support', () => {
    const session = new FakeSession()
    const path = makePath(session, { cost: { usdPerAudioMinute: 0.034 } })

    expect(path.id).toBe('e2e-streaming:fake-e2e')
    expect(path.kind).toBe('e2e-streaming')
    expect(path.isOffline).toBe(false)
    expect(path.cost).toEqual({ usdPerAudioMinute: 0.034 })

    expect(
      () =>
        new E2EStreamingShadowPath({
          engine: { ...engineWith(session), createStreamingSession: undefined }
        })
    ).toThrow(/does not support streaming/)
  })
})
