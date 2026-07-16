import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CloudRealtimeE2E,
  CloudRealtimeSession,
  type RealtimeSocket,
  type RealtimeSocketFactory
} from './CloudRealtimeE2E'
import type { E2EStreamingSink } from '../types'

class MockRealtimeSocket implements RealtimeSocket {
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
  sentTypes(): string[] {
    return this.sent.map((s) => JSON.parse(s).type as string)
  }
  lastSessionUpdate(): Record<string, unknown> | undefined {
    const raw = this.sent.map((s) => JSON.parse(s)).find((e) => e.type === 'session.update')
    return raw
  }
}

function makeHarness(overrides: Record<string, unknown> = {}): {
  sink: { interim: ReturnType<typeof vi.fn>; final: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  controller: AbortController
  session: CloudRealtimeSession
  sockets: MockRealtimeSocket[]
} {
  const sockets: MockRealtimeSocket[] = []
  const factory: RealtimeSocketFactory = () => {
    const s = new MockRealtimeSocket()
    sockets.push(s)
    return s
  }
  const sink = { interim: vi.fn(), final: vi.fn(), error: vi.fn() }
  const controller = new AbortController()
  const session = new CloudRealtimeSession({
    apiKey: 'test-key',
    targetLanguage: 'en',
    socketFactory: factory,
    reconnectBaseDelayMs: 1,
    ...overrides
  })
  return { sink, controller, session, sockets }
}

async function startOpened(h: ReturnType<typeof makeHarness>): Promise<MockRealtimeSocket> {
  await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
  h.sockets[0].emitOpen()
  return h.sockets[0]
}

describe('CloudRealtimeE2E engine', () => {
  it('throws without an API key', () => {
    expect(() => new CloudRealtimeE2E({ apiKey: '' })).toThrow(/OpenAI API key/)
  })

  it('is a non-offline streaming engine and returns a session', () => {
    const engine = new CloudRealtimeE2E({ apiKey: 'k' })
    expect(engine.isOffline).toBe(false)
    expect(engine.id).toBe('cloud-realtime-e2e')
    expect(engine.createStreamingSession()).toBeInstanceOf(CloudRealtimeSession)
  })

  it('does not support single-shot processAudio', async () => {
    const engine = new CloudRealtimeE2E({ apiKey: 'k' })
    expect(await engine.processAudio(new Float32Array(1600), 16000)).toBeNull()
  })
})

describe('CloudRealtimeSession', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('sends session.update with the target output language on open', async () => {
    const h = makeHarness({ targetLanguage: 'ja' })
    const socket = await startOpened(h)
    const update = socket.lastSessionUpdate() as {
      session: { audio: { output: { language: string } } }
    }
    expect(update).toBeDefined()
    expect(update.session.audio.output.language).toBe('ja')
  })

  it('queues audio pushed before open and flushes it as append events after open', async () => {
    const h = makeHarness()
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    await h.session.pushAudio(new Float32Array(1600))
    await h.session.pushAudio(new Float32Array(1600))
    // Not opened yet — nothing sent.
    expect(h.sockets[0].sent.length).toBe(0)

    h.sockets[0].emitOpen()
    const types = h.sockets[0].sentTypes()
    expect(types[0]).toBe('session.update')
    expect(types.filter((t) => t === 'session.input_audio_buffer.append').length).toBe(2)
  })

  it('maps output_transcript.delta to interim results (accumulating)', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'Hello' })
    socket.emitJson({ type: 'session.output_transcript.delta', delta: ' world' })

    expect(h.sink.interim).toHaveBeenCalledTimes(2)
    const last = h.sink.interim.mock.calls[1][0]
    expect(last.translatedText).toBe('Hello world')
    expect(last.isInterim).toBe(true)
    expect(last.targetLanguage).toBe('en')
  })

  it('includes input_transcript deltas as sourceText', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.input_transcript.delta', delta: 'こんにちは' })
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'Hello' })
    const call = h.sink.interim.mock.calls[0][0]
    expect(call.sourceText).toBe('こんにちは')
  })

  it('maps output_transcript.done to a final result and resets buffers', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'Hello world' })
    socket.emitJson({ type: 'session.output_transcript.done', transcript: 'Hello world.' })

    expect(h.sink.final).toHaveBeenCalledTimes(1)
    const finalArg = h.sink.final.mock.calls[0][0]
    expect(finalArg.translatedText).toBe('Hello world.')
    expect(finalArg.isInterim).toBe(false)

    // Buffers reset — a new delta starts fresh.
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'Next' })
    const nextInterim = h.sink.interim.mock.calls.at(-1)![0]
    expect(nextInterim.translatedText).toBe('Next')
  })

  it('flushSegment finalizes the accumulated interim translation', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'partial line' })
    await h.session.flushSegment()
    expect(h.sink.final).toHaveBeenCalledTimes(1)
    expect(h.sink.final.mock.calls[0][0].translatedText).toBe('partial line')
  })

  it('stop({flush}) finalizes buffered interim and closes the socket', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'buffered' })
    await h.session.stop({ flush: true })
    expect(h.sink.final).toHaveBeenCalledTimes(1)
    expect(h.sink.final.mock.calls[0][0].translatedText).toBe('buffered')
    expect(socket.closed).toBe(true)
  })

  it('reports API error events to the sink', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'error', error: { message: 'boom' } })
    expect(h.sink.error).toHaveBeenCalledTimes(1)
    expect(h.sink.error.mock.calls[0][0].message).toBe('boom')
  })

  it('stops emitting after the abort signal fires', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    h.controller.abort()
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'late' })
    socket.emitJson({ type: 'session.output_transcript.done', transcript: 'late.' })
    expect(h.sink.interim).not.toHaveBeenCalled()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('ignores malformed JSON frames', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    expect(() => socket.emitRaw('not-json')).not.toThrow()
    expect(h.sink.interim).not.toHaveBeenCalled()
  })

  it('does not reconnect after an intentional stop', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    await h.session.stop()
    socket.emitClose(1000)
    expect(h.sockets.length).toBe(1)
  })

  it('skips empty audio chunks (no append sent)', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    const beforeAppends = socket.sentTypes().filter((t) => t === 'session.input_audio_buffer.append').length
    await h.session.pushAudio(new Float32Array(0))
    const afterAppends = socket.sentTypes().filter((t) => t === 'session.input_audio_buffer.append').length
    expect(afterAppends).toBe(beforeAppends)
  })

  it('flushSegment does not emit after abort', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'partial' })
    h.sink.interim.mockClear()
    h.controller.abort()
    await h.session.flushSegment()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('flushSegment does not emit after stop (closedByUs guard)', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'partial' })
    await h.session.stop() // no flush
    h.sink.final.mockClear()
    await h.session.flushSegment()
    expect(h.sink.final).not.toHaveBeenCalled()
  })

  it('stop({flush}) after abort intentionally drops the trailing line', async () => {
    const h = makeHarness()
    const socket = await startOpened(h)
    socket.emitJson({ type: 'session.output_transcript.delta', delta: 'trailing' })
    h.controller.abort()
    await h.session.stop({ flush: true })
    expect(h.sink.final).not.toHaveBeenCalled()
  })
})

describe('CloudRealtimeSession reconnect policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('reconnects on unexpected close up to the cap, then errors', async () => {
    const h = makeHarness({ maxReconnectAttempts: 2, reconnectBaseDelayMs: 1 })
    await h.session.start({ sink: h.sink as unknown as E2EStreamingSink, signal: h.controller.signal })
    h.sockets[0].emitOpen()

    // 1st unexpected close → schedule reconnect
    h.sockets[0].emitClose(1006)
    vi.advanceTimersByTime(5)
    expect(h.sockets.length).toBe(2)

    // 2nd close → schedule reconnect
    h.sockets[1].emitClose(1006)
    vi.advanceTimersByTime(5)
    expect(h.sockets.length).toBe(3)

    // 3rd close → cap exhausted → sink.error, no new socket, session torn down
    h.sockets[2].emitClose(1006)
    vi.advanceTimersByTime(5)
    expect(h.sockets.length).toBe(3)
    expect(h.sink.error).toHaveBeenCalledTimes(1)
    expect(h.sink.error.mock.calls[0][0].message).toMatch(/connection lost/)
    // teardown() ran so a pending waitForDrain() would resolve instead of hanging
    expect(h.sockets[2].closed).toBe(true)
  })
})
