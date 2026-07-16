import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  GeminiLiveE2E,
  GeminiLiveSession,
  type GeminiLiveSocket,
  type GeminiLiveSocketFactory
} from './GeminiLiveE2E'
import type { E2EStreamingSink } from '../types'

/** The client→server frames this session is expected to produce. */
interface ClientMessage {
  setup?: {
    model: string
    generationConfig: {
      responseModalities: string[]
      inputAudioTranscription: Record<string, never>
      outputAudioTranscription: Record<string, never>
      translationConfig: { targetLanguageCode: string; echoTargetLanguage: boolean }
    }
  }
  realtimeInput?: { audio?: { data: string; mimeType: string } }
}

class MockGeminiSocket implements GeminiLiveSocket {
  sent: string[] = []
  bufferedAmount = 0
  closed = false
  private openCb?: () => void
  private msgCb?: (d: string) => void
  private errCb?: (e: Error) => void
  private closeCb?: (c: number) => void

  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
  }
  onOpen(cb: () => void): void {
    this.openCb = cb
  }
  onMessage(cb: (d: string) => void): void {
    this.msgCb = cb
  }
  onError(cb: (e: Error) => void): void {
    this.errCb = cb
  }
  onClose(cb: (c: number) => void): void {
    this.closeCb = cb
  }

  // --- test drivers ---
  emitOpen(): void {
    this.openCb?.()
  }
  emitJson(obj: unknown): void {
    this.msgCb?.(JSON.stringify(obj))
  }
  emitRaw(s: string): void {
    this.msgCb?.(s)
  }
  emitError(msg = 'socket error'): void {
    this.errCb?.(new Error(msg))
  }
  emitClose(code = 1006): void {
    this.closeCb?.(code)
  }
  parsed(): ClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMessage)
  }
  setupMessage(): ClientMessage | undefined {
    return this.parsed().find((e) => e.setup)
  }
  audioMessages(): ClientMessage[] {
    return this.parsed().filter((e) => e.realtimeInput?.audio)
  }
}

function makeHarness(overrides: Record<string, unknown> = {}): {
  sink: { interim: ReturnType<typeof vi.fn>; final: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  controller: AbortController
  session: GeminiLiveSession
  sockets: MockGeminiSocket[]
  urls: string[]
  keys: string[]
} {
  const sockets: MockGeminiSocket[] = []
  const urls: string[] = []
  const keys: string[] = []
  const factory: GeminiLiveSocketFactory = (url, apiKey) => {
    urls.push(url)
    keys.push(apiKey)
    const s = new MockGeminiSocket()
    sockets.push(s)
    return s
  }
  const sink = { interim: vi.fn(), final: vi.fn(), error: vi.fn() }
  const controller = new AbortController()
  const session = new GeminiLiveSession({
    apiKey: 'test-key',
    targetLanguage: 'en',
    socketFactory: factory,
    reconnectBaseDelayMs: 1,
    ...overrides
  })
  return { sink, controller, session, sockets, urls, keys }
}

/** Drive the full handshake: socket open → setup sent → setupComplete acked. */
async function startReady(h: ReturnType<typeof makeHarness>): Promise<MockGeminiSocket> {
  await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
  h.sockets[0].emitOpen()
  h.sockets[0].emitJson({ setupComplete: {} })
  return h.sockets[0]
}

describe('GeminiLiveE2E engine', () => {
  it('throws without an API key', () => {
    expect(() => new GeminiLiveE2E({ apiKey: '' })).toThrow(/Gemini API key/)
  })

  it('is a non-offline streaming engine and returns a session', () => {
    const engine = new GeminiLiveE2E({ apiKey: 'k' })
    expect(engine.isOffline).toBe(false)
    expect(engine.id).toBe('gemini-live-e2e')
    expect(engine.createStreamingSession()).toBeInstanceOf(GeminiLiveSession)
  })

  it('does not support single-shot processAudio', async () => {
    const engine = new GeminiLiveE2E({ apiKey: 'k' })
    expect(await engine.processAudio(new Float32Array(1600), 16000)).toBeNull()
  })
})

describe('GeminiLiveSession setup handshake', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('sends the BidiGenerateContent setup message with the preview model on open', async () => {
    const h = makeHarness()
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    h.sockets[0].emitOpen()
    const setup = h.sockets[0].setupMessage()!.setup!
    expect(setup.model).toBe('models/gemini-3.5-live-translate-preview')
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(setup.generationConfig.inputAudioTranscription).toEqual({})
    expect(setup.generationConfig.outputAudioTranscription).toEqual({})
  })

  it('sets the target language and echoes same-language speech instead of going silent', async () => {
    const h = makeHarness({ targetLanguage: 'ja' })
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    h.sockets[0].emitOpen()
    const cfg = h.sockets[0].setupMessage()!.setup!.generationConfig.translationConfig
    expect(cfg.targetLanguageCode).toBe('ja')
    expect(cfg.echoTargetLanguage).toBe(true)
  })

  it('passes the key to the factory separately and keeps it out of the endpoint URL', async () => {
    const h = makeHarness({ apiKey: 'secret-key' })
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    expect(h.urls[0]).toContain('BidiGenerateContent')
    expect(h.urls[0]).not.toContain('secret-key')
    expect(h.urls[0]).not.toContain('key=')
    expect(h.keys[0]).toBe('secret-key')
  })

  it('withholds audio until setupComplete, then flushes it as realtimeInput', async () => {
    const h = makeHarness()
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    await h.session.pushAudio(new Float32Array(1600))
    h.sockets[0].emitOpen()
    await h.session.pushAudio(new Float32Array(1600))

    // Setup sent, but no audio may flow before the handshake is acked.
    expect(h.sockets[0].audioMessages().length).toBe(0)

    h.sockets[0].emitJson({ setupComplete: {} })
    const audio = h.sockets[0].audioMessages()
    expect(audio.length).toBe(2)
    expect(audio[0].realtimeInput!.audio!.mimeType).toBe('audio/pcm;rate=16000')
    expect(typeof audio[0].realtimeInput!.audio!.data).toBe('string')
  })
})

describe('GeminiLiveSession transcript mapping', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('maps outputTranscription to interim results (accumulating)', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'Hello' } } })
    socket.emitJson({ serverContent: { outputTranscription: { text: ' world' } } })

    expect(h.sink.interim).toHaveBeenCalledTimes(2)
    const last = h.sink.interim.mock.calls[1][0]
    expect(last.translatedText).toBe('Hello world')
    expect(last.isInterim).toBe(true)
    expect(last.targetLanguage).toBe('en')
  })

  it('includes inputTranscription as sourceText', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { inputTranscription: { text: 'こんにちは' } } })
    socket.emitJson({ serverContent: { outputTranscription: { text: 'Hello' } } })
    expect(h.sink.interim.mock.calls[0][0].sourceText).toBe('こんにちは')
  })

  it('maps turnComplete to a final result and resets buffers', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'Hello world' } } })
    socket.emitJson({ serverContent: { turnComplete: true } })

    expect(h.sink.final).toHaveBeenCalledTimes(1)
    const finalArg = h.sink.final.mock.calls[0][0]
    expect(finalArg.translatedText).toBe('Hello world')
    expect(finalArg.isInterim).toBe(false)

    // Buffers reset — a new delta starts fresh.
    socket.emitJson({ serverContent: { outputTranscription: { text: 'Next' } } })
    expect(h.sink.interim.mock.calls.at(-1)![0].translatedText).toBe('Next')
  })

  it('accepts a transcript and turnComplete arriving in the same frame', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'One shot' }, turnComplete: true } })
    expect(h.sink.final).toHaveBeenCalledTimes(1)
    expect(h.sink.final.mock.calls[0][0].translatedText).toBe('One shot')
  })

  it('accepts proto snake_case field spellings (preview JSON mapping)', async () => {
    const h = makeHarness()
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    h.sockets[0].emitOpen()
    h.sockets[0].emitJson({ setup_complete: {} })
    h.sockets[0].emitJson({
      server_content: { input_transcription: { text: 'やあ' }, output_transcription: { text: 'Hi' } }
    })
    h.sockets[0].emitJson({ server_content: { turn_complete: true } })

    expect(h.sink.interim.mock.calls[0][0].sourceText).toBe('やあ')
    expect(h.sink.final).toHaveBeenCalledTimes(1)
    expect(h.sink.final.mock.calls[0][0].translatedText).toBe('Hi')
  })

  it('does not emit a final for a turnComplete with no accumulated translation', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { turnComplete: true } })
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('ignores synthesized audio parts (subtitles only, no TTS)', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] } }
    })
    expect(h.sink.interim).not.toHaveBeenCalled()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('labels ja as the source language for an en-target session', async () => {
    const h = makeHarness({ targetLanguage: 'en' })
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'Hello' } } })
    expect(h.sink.interim.mock.calls[0][0].sourceLanguage).toBe('ja')
  })

  it('flushSegment finalizes the accumulated interim translation', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'partial line' } } })
    await h.session.flushSegment()
    expect(h.sink.final).toHaveBeenCalledTimes(1)
    expect(h.sink.final.mock.calls[0][0].translatedText).toBe('partial line')
  })

  it('stop({flush}) finalizes buffered interim and closes the socket', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'buffered' } } })
    await h.session.stop({ flush: true })
    expect(h.sink.final).toHaveBeenCalledTimes(1)
    expect(h.sink.final.mock.calls[0][0].translatedText).toBe('buffered')
    expect(socket.closed).toBe(true)
  })

  it('reports API error events to the sink', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ error: { message: 'boom' } })
    expect(h.sink.error).toHaveBeenCalledTimes(1)
    expect(h.sink.error.mock.calls[0][0].message).toBe('boom')
  })

  it('surfaces goAway as a status notice without erroring the sink', async () => {
    const statuses: string[] = []
    const h = makeHarness({ onStatus: (m: string) => statuses.push(m) })
    const socket = await startReady(h)
    socket.emitJson({ goAway: { timeLeft: '5s' } })
    expect(h.sink.error).not.toHaveBeenCalled()
    expect(statuses.some((s) => /session ending/i.test(s))).toBe(true)
  })

  it('stops emitting after the abort signal fires', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    h.controller.abort()
    socket.emitJson({ serverContent: { outputTranscription: { text: 'late' } } })
    socket.emitJson({ serverContent: { turnComplete: true } })
    expect(h.sink.interim).not.toHaveBeenCalled()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('ignores malformed JSON frames', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    expect(() => socket.emitRaw('not-json')).not.toThrow()
    expect(h.sink.interim).not.toHaveBeenCalled()
  })

  it('does not reconnect after an intentional stop', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    await h.session.stop()
    socket.emitClose(1000)
    expect(h.sockets.length).toBe(1)
  })

  it('skips empty audio chunks (no realtimeInput sent)', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    await h.session.pushAudio(new Float32Array(0))
    expect(socket.audioMessages().length).toBe(0)
  })

  it('flushSegment does not emit after abort', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'partial' } } })
    h.controller.abort()
    await h.session.flushSegment()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('flushSegment does not emit after stop (closedByUs guard)', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'partial' } } })
    await h.session.stop() // no flush
    h.sink.final.mockClear()
    await h.session.flushSegment()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('stop({flush}) after abort intentionally drops the trailing line', async () => {
    const h = makeHarness()
    const socket = await startReady(h)
    socket.emitJson({ serverContent: { outputTranscription: { text: 'trailing' } } })
    h.controller.abort()
    await h.session.stop({ flush: true })
    expect(h.sink.final).not.toHaveBeenCalled()
  })
})

describe('GeminiLiveSession reconnect policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('reconnects on unexpected close up to the cap, then errors', async () => {
    const h = makeHarness({ maxReconnectAttempts: 2, reconnectBaseDelayMs: 1 })
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    h.sockets[0].emitOpen()
    h.sockets[0].emitJson({ setupComplete: {} })

    h.sockets[0].emitClose(1006)
    vi.advanceTimersByTime(5)
    expect(h.sockets.length).toBe(2)

    h.sockets[1].emitClose(1006)
    vi.advanceTimersByTime(5)
    expect(h.sockets.length).toBe(3)

    // Cap exhausted → sink.error, no new socket, session torn down.
    h.sockets[2].emitClose(1006)
    vi.advanceTimersByTime(5)
    expect(h.sockets.length).toBe(3)
    expect(h.sink.error).toHaveBeenCalledTimes(1)
    expect(h.sink.error.mock.calls[0][0].message).toMatch(/connection lost/)
    expect(h.sockets[2].closed).toBe(true)
  })

  it('re-runs the setup handshake on each reconnect', async () => {
    const h = makeHarness({ maxReconnectAttempts: 1, reconnectBaseDelayMs: 1 })
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    h.sockets[0].emitOpen()
    h.sockets[0].emitJson({ setupComplete: {} })

    h.sockets[0].emitClose(1006)
    vi.advanceTimersByTime(5)
    h.sockets[1].emitOpen()
    expect(h.sockets[1].setupMessage()).toBeDefined()
  })
})
