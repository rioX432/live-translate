import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { RealtimeAudioDispatcher } from './realtime-audio'
import type { AppContext } from './app-context'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function makeCtx(): { ctx: AppContext; pushRealtimeAudio: ReturnType<typeof vi.fn>; onSpeechBoundary: ReturnType<typeof vi.fn>; setRunning: (v: boolean) => void } {
  const pushRealtimeAudio = vi.fn().mockResolvedValue(undefined)
  const onSpeechBoundary = vi.fn().mockResolvedValue(undefined)
  const pipeline = { running: true, pushRealtimeAudio, onSpeechBoundary }
  const ctx = { pipeline } as unknown as AppContext
  return { ctx, pushRealtimeAudio, onSpeechBoundary, setRunning: (v) => { pipeline.running = v } }
}

const chunk = (): Float32Array => new Float32Array(1600).fill(0.1)

describe('RealtimeAudioDispatcher (#721)', () => {
  let d: RealtimeAudioDispatcher

  beforeEach(() => {
    d = new RealtimeAudioDispatcher(4) // small cap for testability
  })

  it('forwards chunks in order to pushRealtimeAudio', async () => {
    const { ctx, pushRealtimeAudio } = makeCtx()
    for (let i = 0; i < 3; i++) d.pushAudio(ctx, chunk())
    await flush()
    expect(pushRealtimeAudio).toHaveBeenCalledTimes(3)
  })

  it('drops chunks past the pending cap instead of growing unbounded', async () => {
    const { ctx, pushRealtimeAudio } = makeCtx()
    // Enqueue synchronously: pending increments before any chain link drains, so
    // only `cap` (4) chunks are accepted and the remaining 6 are dropped.
    for (let i = 0; i < 10; i++) d.pushAudio(ctx, chunk())
    await flush()
    expect(pushRealtimeAudio).toHaveBeenCalledTimes(4)
  })

  it('ignores audio when the pipeline is not running', async () => {
    const { ctx, pushRealtimeAudio, setRunning } = makeCtx()
    setRunning(false)
    d.pushAudio(ctx, chunk())
    await flush()
    expect(pushRealtimeAudio).not.toHaveBeenCalled()
  })

  it('ignores empty chunks', async () => {
    const { ctx, pushRealtimeAudio } = makeCtx()
    d.pushAudio(ctx, new Float32Array(0))
    await flush()
    expect(pushRealtimeAudio).not.toHaveBeenCalled()
  })

  it('finalizes a segment only on an end boundary, sequenced after queued audio', async () => {
    const { ctx, pushRealtimeAudio, onSpeechBoundary } = makeCtx()
    const order: string[] = []
    pushRealtimeAudio.mockImplementation(async () => { order.push('audio') })
    onSpeechBoundary.mockImplementation(async () => { order.push('boundary') })

    d.pushAudio(ctx, chunk())
    d.pushAudio(ctx, chunk())
    d.signalBoundary(ctx, 'start') // no-op
    d.signalBoundary(ctx, 'end')
    await flush()

    expect(onSpeechBoundary).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['audio', 'audio', 'boundary']) // boundary never precedes its audio
  })

  it('reset() invalidates chunks queued for a superseded session', async () => {
    const { ctx, pushRealtimeAudio } = makeCtx()
    d.pushAudio(ctx, chunk()) // queued for the old generation
    d.pushAudio(ctx, chunk())
    d.reset()                 // new session generation — old chunks are stale
    await flush()
    // Both queued chunks carry the old epoch, so neither reaches the pipeline
    expect(pushRealtimeAudio).not.toHaveBeenCalled()
  })
})
