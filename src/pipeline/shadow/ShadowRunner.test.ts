import { describe, it, expect, beforeEach } from 'vitest'
import { ShadowRunner } from './ShadowRunner'
import type { ShadowPath, PathSampleResult, ShadowCostModel } from './types'

const OFFLINE_COST: ShadowCostModel = { usdPerMillionChars: 0 }
const CLOUD_COST: ShadowCostModel = { usdPerMillionChars: 20 }
/** gpt-realtime-translate is billed per audio minute, not per character. */
const REALTIME_COST: ShadowCostModel = { usdPerAudioMinute: 0.034 }

/** Deferred promise helper for controlling when a path resolves. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A configurable mock path. */
class MockPath implements ShadowPath {
  readonly kind = 'cascade' as const
  calls: Array<{ audio: Float32Array; sampleRate: number }> = []

  constructor(
    readonly id: string,
    readonly usesLocalLlm = false,
    readonly isOffline = true,
    readonly cost: ShadowCostModel = OFFLINE_COST,
    private readonly handler: (
      audio: Float32Array,
      sampleRate: number,
      signal: AbortSignal
    ) => Promise<PathSampleResult> = async (a) => ({
      sourceText: 'x'.repeat(a.length),
      translatedText: 'y',
      firstSubtitleMs: 10,
      revisionCount: 0
    })
  ) {}

  async process(audio: Float32Array, sampleRate: number, signal: AbortSignal): Promise<PathSampleResult> {
    this.calls.push({ audio, sampleRate })
    return this.handler(audio, sampleRate, signal)
  }
}

describe('ShadowRunner', () => {
  let runner: ShadowRunner

  beforeEach(() => {
    runner = new ShadowRunner()
  })

  it('fans identical audio out to multiple paths in parallel and records a sample each', async () => {
    const a = new MockPath('a')
    const b = new MockPath('b')
    runner.register(a)
    runner.register(b)

    runner.start()
    const audio = new Float32Array([1, 2, 3])
    runner.submit(audio, 16000)
    await runner.whenIdle()

    expect(a.calls).toHaveLength(1)
    expect(b.calls).toHaveLength(1)
    // Both paths see the same content...
    expect(Array.from(a.calls[0]!.audio)).toEqual([1, 2, 3])
    expect(Array.from(b.calls[0]!.audio)).toEqual([1, 2, 3])

    const samples = runner.getSamples()
    expect(samples).toHaveLength(2)
    expect(new Set(samples.map((s) => s.pathId))).toEqual(new Set(['a', 'b']))
  })

  it('snapshots audio so later mutation of the caller buffer does not affect paths', async () => {
    const seen = deferred<void>()
    const path = new MockPath('p', false, true, OFFLINE_COST, async (audio) => {
      seen.resolve()
      return { sourceText: Array.from(audio).join(','), translatedText: '', firstSubtitleMs: null, revisionCount: 0 }
    })
    runner.register(path)
    runner.start()

    const audio = new Float32Array([5, 6, 7])
    runner.submit(audio, 16000)
    await seen.promise
    audio[0] = 999 // mutate after submit
    await runner.whenIdle()

    expect(Array.from(path.calls[0]!.audio)).toEqual([5, 6, 7])
  })

  it('drops (does not queue) a segment when the path is still busy', async () => {
    const gate = deferred<PathSampleResult>()
    const path = new MockPath('busy', false, true, OFFLINE_COST, () => gate.promise)
    runner.register(path)
    runner.start()

    runner.submit(new Float32Array([1]), 16000) // occupies the single permit
    runner.submit(new Float32Array([2]), 16000) // should be dropped as path-busy

    const drops = runner.getDrops()
    expect(drops).toHaveLength(1)
    expect(drops[0]!.reason).toBe('path-busy')
    expect(path.calls).toHaveLength(1) // second submit never reached the engine

    gate.resolve({ sourceText: 'ok', translatedText: 't', firstSubtitleMs: 5, revisionCount: 1 })
    await runner.whenIdle()
    expect(runner.getSamples()).toHaveLength(1)
  })

  it('discards results that resolve after stop() (cancellation)', async () => {
    const gate = deferred<PathSampleResult>()
    const path = new MockPath('slow', false, true, OFFLINE_COST, () => gate.promise)
    runner.register(path)
    runner.start()
    runner.submit(new Float32Array([1]), 16000)

    const stopPromise = runner.stop()
    // Resolve the path AFTER stop() was requested — the result must be discarded.
    gate.resolve({ sourceText: 'late', translatedText: 't', firstSubtitleMs: 5, revisionCount: 0 })
    await stopPromise

    expect(runner.getSamples()).toHaveLength(0)
  })

  it('serializes local-LLM paths behind a single global permit', async () => {
    const gate1 = deferred<PathSampleResult>()
    const gate2 = deferred<PathSampleResult>()
    const llmA = new MockPath('llmA', true, true, OFFLINE_COST, () => gate1.promise)
    const llmB = new MockPath('llmB', true, true, OFFLINE_COST, () => gate2.promise)
    // Local-LLM paths default disabled; enable both at full sampling.
    runner.register(llmA, { enabled: true, samplingInterval: 1 })
    runner.register(llmB, { enabled: true, samplingInterval: 1 })
    runner.start()

    runner.submit(new Float32Array([1]), 16000)

    // Only one of the two LLM paths runs; the other is dropped as local-llm-busy.
    const started = llmA.calls.length + llmB.calls.length
    expect(started).toBe(1)
    const drops = runner.getDrops()
    expect(drops).toHaveLength(1)
    expect(drops[0]!.reason).toBe('local-llm-busy')

    gate1.resolve({ sourceText: 'a', translatedText: 't', firstSubtitleMs: 1, revisionCount: 0 })
    gate2.resolve({ sourceText: 'b', translatedText: 't', firstSubtitleMs: 1, revisionCount: 0 })
    await runner.whenIdle()
  })

  it('applies 1-in-N sampling for thinned paths', async () => {
    const path = new MockPath('sampled')
    runner.register(path, { enabled: true, samplingInterval: 3 })
    runner.start()

    for (let i = 0; i < 6; i++) {
      runner.submit(new Float32Array([i]), 16000)
      await runner.whenIdle()
    }

    // Segments 0 and 3 measured; 1,2,4,5 dropped as sampling.
    expect(path.calls).toHaveLength(2)
    const samplingDrops = runner.getDrops().filter((d) => d.reason === 'sampling')
    expect(samplingDrops).toHaveLength(4)
  })

  it('local-LLM paths default to disabled', async () => {
    const llm = new MockPath('llm', true)
    runner.register(llm) // no override
    runner.start()
    runner.submit(new Float32Array([1]), 16000)
    await runner.whenIdle()

    expect(llm.calls).toHaveLength(0)
    expect(runner.getDrops()[0]!.reason).toBe('disabled')
  })

  it('records errors without recording a sample', async () => {
    const path = new MockPath('err', false, true, OFFLINE_COST, async () => {
      throw new Error('boom')
    })
    runner.register(path)
    runner.start()
    runner.submit(new Float32Array([1]), 16000)
    await runner.whenIdle()

    expect(runner.getSamples()).toHaveLength(0)
    const errors = runner.getErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe('boom')
  })

  it('ignores submit when not running', () => {
    const path = new MockPath('p')
    runner.register(path)
    const id = runner.submit(new Float32Array([1]), 16000)
    expect(id).toBe(-1)
    expect(path.calls).toHaveLength(0)
  })

  it('discards stale results from a previous run after stop() then start()', async () => {
    const gate = deferred<PathSampleResult>()
    let call = 0
    const path = new MockPath('restart', false, true, OFFLINE_COST, () => {
      call++
      return call === 1
        ? gate.promise // first run: hangs past stop()
        : Promise.resolve({ sourceText: 'fresh', translatedText: 't', firstSubtitleMs: 1, revisionCount: 0 })
    })
    // Tiny drain timeout so stop() returns while the first task is still in-flight.
    const r = new ShadowRunner({ stopDrainTimeoutMs: 10 })
    r.register(path)

    r.start()
    r.submit(new Float32Array([1]), 16000)
    await r.stop() // returns via drain timeout; first task still pending

    r.start()
    // Resolve the run-1 task while run 2 is active — it must NOT be recorded
    // into run 2 telemetry (generation guard), and it releases the path permit.
    gate.resolve({ sourceText: 'stale', translatedText: 't', firstSubtitleMs: 1, revisionCount: 0 })
    await r.whenIdle()
    expect(r.getSamples()).toHaveLength(0)

    r.submit(new Float32Array([2]), 16000)
    await r.whenIdle()

    const samples = r.getSamples()
    expect(samples).toHaveLength(1)
    expect(samples[0]!.sourceChars).toBe('fresh'.length)
  })

  it('bounds telemetry buffers at maxRecords', async () => {
    const path = new MockPath('bounded')
    const r = new ShadowRunner({ maxRecords: 3 })
    r.register(path)
    r.start()

    for (let i = 0; i < 5; i++) {
      r.submit(new Float32Array([i]), 16000)
      await r.whenIdle()
    }

    expect(r.getSamples()).toHaveLength(3)
    // Oldest evicted: remaining samples are the last three segments.
    expect(r.getSamples().map((s) => s.segmentId)).toEqual([2, 3, 4])
  })

  it('aggregates a multivariate report with cost, privacy, and drop rate', async () => {
    const offline = new MockPath('offline', false, true, OFFLINE_COST, async () => ({
      sourceText: 'hello', // 5 chars
      translatedText: 'x',
      firstSubtitleMs: 12,
      revisionCount: 2
    }))
    const cloud = new MockPath('cloud', false, false, CLOUD_COST, async () => ({
      sourceText: 'hello', // 5 chars * $20/M = $0.0001
      translatedText: 'x',
      firstSubtitleMs: 30,
      revisionCount: 0
    }))
    runner.register(offline)
    runner.register(cloud)
    runner.start()
    runner.submit(new Float32Array([1]), 16000)
    await runner.whenIdle()

    const report = runner.getReport()
    const offlineSummary = report.paths.find((p) => p.pathId === 'offline')!
    const cloudSummary = report.paths.find((p) => p.pathId === 'cloud')!

    expect(offlineSummary.processedCount).toBe(1)
    expect(offlineSummary.offlineCompleteness).toBe(1)
    expect(offlineSummary.totalCostUsd).toBe(0)
    expect(offlineSummary.meanRevisionCount).toBe(2)

    expect(cloudSummary.offlineCompleteness).toBe(0)
    expect(cloudSummary.totalCostUsd).toBeCloseTo((5 / 1_000_000) * 20, 12)
    expect(cloudSummary.latency.p50).toBeGreaterThanOrEqual(0)
  })

  it('setPathEnabled gates a path mid-run and records the skips as policy drops, not saturation', async () => {
    const both = new MockPath('both')
    const gated = new MockPath('gated')
    runner.register(both)
    runner.register(gated)
    runner.start()

    runner.submit(new Float32Array([1]), 16000)
    await runner.whenIdle()
    runner.setPathEnabled('gated', false)
    runner.submit(new Float32Array([1]), 16000)
    await runner.whenIdle()
    runner.setPathEnabled('gated', true)
    runner.submit(new Float32Array([1]), 16000)
    await runner.whenIdle()

    const summary = runner.getReport().paths.find((p) => p.pathId === 'gated')!
    expect(summary.processedCount).toBe(2)
    expect(summary.droppedCount).toBe(1)
    // A path that sat out by policy is not a saturated path.
    expect(summary.busyDropRate).toBe(0)
    expect(runner.getDrops()).toEqual([
      expect.objectContaining({ pathId: 'gated', reason: 'disabled' })
    ])
  })

  it('setPathEnabled ignores an unknown path id', () => {
    expect(() => runner.setPathEnabled('nope', false)).not.toThrow()
  })

  it('bills a speech-metered path by submitted audio duration, not by transcript length', async () => {
    const realtime = new MockPath('realtime', false, false, REALTIME_COST, async () => ({
      sourceText: 'a very long transcript that would dominate a per-character bill',
      translatedText: 'x',
      firstSubtitleMs: 30,
      revisionCount: 1
    }))
    runner.register(realtime)
    runner.start()
    // 48000 samples @ 16kHz = 3s = 0.05 min * $0.034/min.
    runner.submit(new Float32Array(48000), 16000)
    await runner.whenIdle()

    const summary = runner.getReport().paths.find((p) => p.pathId === 'realtime')!
    expect(summary.totalCostUsd).toBeCloseTo((3 / 60) * 0.034, 12)
    expect(runner.getSamples()[0]!.audioDurationMs).toBeCloseTo(3000, 6)
  })
})
