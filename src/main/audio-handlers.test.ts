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
import type { AppContext } from './app-context'

function makePipeline(): {
  running: boolean
  process: ReturnType<typeof vi.fn>
  processStreaming: ReturnType<typeof vi.fn>
  finalizeStreaming: ReturnType<typeof vi.fn>
} {
  return {
    running: true,
    process: vi.fn().mockResolvedValue(null),
    processStreaming: vi.fn().mockResolvedValue(null),
    finalizeStreaming: vi.fn().mockResolvedValue(null)
  }
}

describe('registerAudioHandlers', () => {
  let pipeline: ReturnType<typeof makePipeline>
  let ctx: AppContext

  beforeEach(() => {
    handlers.clear()
    pipeline = makePipeline()
    ctx = { pipeline, mainWindow: { webContents: { send: vi.fn() } } } as unknown as AppContext
    registerAudioHandlers(ctx)
  })

  it('streaming chunks below the 0.5s minimum are still dropped', async () => {
    const short = Array.from(new Float32Array(1600).fill(0.5))
    await handlers.get('process-audio-streaming')!(null, short)
    expect(pipeline.processStreaming).not.toHaveBeenCalled()
  })

  it('a valid streaming chunk still reaches processStreaming', async () => {
    const valid = Array.from(new Float32Array(8000).fill(0.5))
    await handlers.get('process-audio-streaming')!(null, valid)
    expect(pipeline.processStreaming).toHaveBeenCalledTimes(1)
  })
})
