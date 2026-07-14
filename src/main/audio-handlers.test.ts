import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture ipcMain handlers registered by registerAudioHandlers
const handlers = new Map<string, (event: unknown, arg: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, arg: unknown) => unknown) => {
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

vi.mock('./error-utils', () => ({
  sanitizeErrorMessage: (m: string) => m
}))

import { registerAudioHandlers } from './audio-handlers'
import { resetRealtimeAudioDispatcher } from './realtime-audio'
import type { AppContext } from './app-context'

// Flush the microtask queue so the realtime promise chain settles
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function makePipeline(): {
  running: boolean
  process: ReturnType<typeof vi.fn>
  processStreaming: ReturnType<typeof vi.fn>
  finalizeStreaming: ReturnType<typeof vi.fn>
  pushRealtimeAudio: ReturnType<typeof vi.fn>
  onSpeechBoundary: ReturnType<typeof vi.fn>
} {
  return {
    running: true,
    process: vi.fn().mockResolvedValue(null),
    processStreaming: vi.fn().mockResolvedValue(null),
    finalizeStreaming: vi.fn().mockResolvedValue(null),
    pushRealtimeAudio: vi.fn().mockResolvedValue(undefined),
    onSpeechBoundary: vi.fn().mockResolvedValue(undefined)
  }
}

describe('registerAudioHandlers (#721)', () => {
  let pipeline: ReturnType<typeof makePipeline>
  let ctx: AppContext

  beforeEach(() => {
    handlers.clear()
    resetRealtimeAudioDispatcher() // isolate the shared realtime chain between cases
    pipeline = makePipeline()
    ctx = { pipeline, mainWindow: { webContents: { send: vi.fn() } } } as unknown as AppContext
    registerAudioHandlers(ctx)
  })

  it('routes a sub-0.5s realtime chunk to pushRealtimeAudio (bypasses the 8000-sample minimum)', async () => {
    const chunk = Array.from(new Float32Array(1600).fill(0.5)) // 100ms at 16kHz
    await handlers.get('push-realtime-audio')!(null, chunk)
    await flush()

    expect(pipeline.pushRealtimeAudio).toHaveBeenCalledTimes(1)
    const arg = pipeline.pushRealtimeAudio.mock.calls[0][0]
    expect(arg).toBeInstanceOf(Float32Array)
    expect(arg.length).toBe(1600)
    // Realtime audio must not leak into the cascade STT path
    expect(pipeline.processStreaming).not.toHaveBeenCalled()
  })

  it('preserves order across many realtime chunks via the sequential chain', async () => {
    for (let i = 0; i < 5; i++) {
      await handlers.get('push-realtime-audio')!(null, Array.from(new Float32Array(1600).fill(i / 10)))
    }
    await flush()
    expect(pipeline.pushRealtimeAudio).toHaveBeenCalledTimes(5)
  })

  it('keeps pushing after a rejected chunk (per-link catch, no chain poisoning)', async () => {
    pipeline.pushRealtimeAudio.mockRejectedValueOnce(new Error('boom'))
    await handlers.get('push-realtime-audio')!(null, Array.from(new Float32Array(1600)))
    await handlers.get('push-realtime-audio')!(null, Array.from(new Float32Array(1600)))
    await flush()
    expect(pipeline.pushRealtimeAudio).toHaveBeenCalledTimes(2)
  })

  it('finalizes the segment only on a speech-end boundary hint', async () => {
    await handlers.get('speech-boundary')!(null, 'start')
    expect(pipeline.onSpeechBoundary).not.toHaveBeenCalled()
    await handlers.get('speech-boundary')!(null, 'end')
    expect(pipeline.onSpeechBoundary).toHaveBeenCalledTimes(1)
  })

  it('cascade regression: streaming chunks below the 0.5s minimum are still dropped', async () => {
    const short = Array.from(new Float32Array(1600).fill(0.5))
    await handlers.get('process-audio-streaming')!(null, short)
    expect(pipeline.processStreaming).not.toHaveBeenCalled()
  })

  it('cascade regression: a valid streaming chunk still reaches processStreaming', async () => {
    const valid = Array.from(new Float32Array(8000).fill(0.5))
    await handlers.get('process-audio-streaming')!(null, valid)
    expect(pipeline.processStreaming).toHaveBeenCalledTimes(1)
  })

  it('ignores realtime audio when the pipeline is not running', async () => {
    pipeline.running = false
    await handlers.get('push-realtime-audio')!(null, Array.from(new Float32Array(1600)))
    await flush()
    expect(pipeline.pushRealtimeAudio).not.toHaveBeenCalled()
  })
})
