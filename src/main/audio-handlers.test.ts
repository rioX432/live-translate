import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, arg?: unknown) => unknown

// Capture ipcMain handlers registered by registerAudioHandlers
const handlers = new Map<string, Handler>()
const listeners = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { handlers.set(channel, fn) },
    on: (channel: string, fn: Handler) => { listeners.set(channel, fn) }
  }
}))

const setupAudioPort = vi.fn()
vi.mock('./audio-port', () => ({ setupAudioPort: (...args: unknown[]) => setupAudioPort(...args) }))

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { registerAudioHandlers } from './audio-handlers'
import { parseAudioMessage } from './audio-routing'
import type { AppContext } from './app-context'

function makePipeline(): {
  running: boolean
  processStreaming: ReturnType<typeof vi.fn>
  finalizeStreaming: ReturnType<typeof vi.fn>
} {
  return {
    running: true,
    processStreaming: vi.fn().mockResolvedValue(null),
    finalizeStreaming: vi.fn().mockResolvedValue(null)
  }
}

const samples = (n: number, value = 0.5): number[] => Array.from(new Float32Array(n).fill(value))

describe('registerAudioHandlers', () => {
  let pipeline: ReturnType<typeof makePipeline>
  let ctx: AppContext
  const mainContents = { send: vi.fn() }

  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    setupAudioPort.mockClear()
    pipeline = makePipeline()
    ctx = { pipeline, mainWindow: { webContents: mainContents } } as unknown as AppContext
    registerAudioHandlers(ctx)
  })

  it('no longer registers the legacy process-audio channel', () => {
    expect(handlers.has('process-audio')).toBe(false)
  })

  it('streaming chunks below the 0.5s minimum are dropped', async () => {
    await handlers.get('process-audio-streaming')!(null, { segmentId: 's1', audio: samples(1600) })
    expect(pipeline.processStreaming).not.toHaveBeenCalled()
  })

  it('a valid streaming chunk reaches processStreaming with its segment id', async () => {
    await handlers.get('process-audio-streaming')!(null, { segmentId: 's1', audio: samples(8000) })
    expect(pipeline.processStreaming).toHaveBeenCalledWith(expect.any(Float32Array), 16000, 's1')
  })

  it('a bare array without a segment id is rejected', async () => {
    await handlers.get('process-audio-streaming')!(null, samples(8000))
    await handlers.get('finalize-streaming')!(null, samples(8000))
    expect(pipeline.processStreaming).not.toHaveBeenCalled()
    expect(pipeline.finalizeStreaming).not.toHaveBeenCalled()
  })

  it('short and quiet finals still reach the pipeline so the segment can close', async () => {
    await handlers.get('finalize-streaming')!(null, { segmentId: 's1', audio: samples(1600) })
    await handlers.get('finalize-streaming')!(null, { segmentId: 's2', audio: samples(8000, 0) })
    expect(pipeline.finalizeStreaming.mock.calls.map((c) => c[2])).toEqual(['s1', 's2'])
  })

  it('passes speechEndedAt through to the pipeline', async () => {
    await handlers.get('finalize-streaming')!(null, { segmentId: 's1', audio: samples(8000), speechEndedAt: 1234 })
    expect(pipeline.finalizeStreaming).toHaveBeenCalledWith(expect.any(Float32Array), 16000, 's1', { speechEndedAt: 1234 })
  })

  it('a final arriving while another final is in flight still reaches the pipeline', async () => {
    let release!: () => void
    pipeline.finalizeStreaming.mockImplementationOnce(() => new Promise((r) => { release = () => r(null) }))

    const first = handlers.get('finalize-streaming')!(null, { segmentId: 's1', audio: samples(8000) })
    const second = handlers.get('finalize-streaming')!(null, { segmentId: 's2', audio: samples(8000) })
    release()
    await Promise.all([first, second])

    expect(pipeline.finalizeStreaming).toHaveBeenCalledTimes(2)
  })

  it('hands out an audio port only to the settings window', () => {
    listeners.get('request-audio-port')!({ sender: { send: vi.fn() } })
    expect(setupAudioPort).not.toHaveBeenCalled()
    listeners.get('request-audio-port')!({ sender: mainContents })
    expect(setupAudioPort).toHaveBeenCalledWith(ctx, mainContents)
  })
})

describe('parseAudioMessage', () => {
  it('accepts an ArrayBuffer from the MessagePort', () => {
    const audio = new Float32Array([0.1, 0.2]).buffer
    const msg = parseAudioMessage('final', { segmentId: 'a-1', audio })
    expect(msg?.audio).toBeInstanceOf(Float32Array)
    expect(msg?.audio.length).toBe(2)
  })

  it('rejects segment ids that could smuggle path or log content', () => {
    for (const segmentId of ['', '../x', 'a b', 'x'.repeat(65), 42]) {
      expect(parseAudioMessage('final', { segmentId, audio: [0] })).toBeNull()
    }
  })

  it('drops a non-finite speechEndedAt instead of passing it on', () => {
    const msg = parseAudioMessage('final', { segmentId: 's1', audio: [0], speechEndedAt: Number.NaN })
    expect(msg).not.toBeNull()
    expect(msg && 'speechEndedAt' in msg).toBe(false)
  })
})
