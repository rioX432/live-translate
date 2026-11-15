import { describe, it, expect, vi, afterEach } from 'vitest'
import { TranslationPipeline, PipelineState } from './TranslationPipeline'
import type { STTEngine, STTResult, TranslatorEngine, TranslationResult } from '../engines/types'

/** Speech-level audio: 1s of a 0.1-amplitude tone, well above the low-energy gate */
function speech(seconds = 1): Float32Array {
  const out = new Float32Array(16000 * seconds)
  for (let i = 0; i < out.length; i++) out[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / 16000)
  return out
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function stt(text: string, language: 'ja' | 'en' = 'en'): STTResult {
  return { text, language, isFinal: true, timestamp: Date.now() }
}

/** STT whose calls are answered in order from a script; tracks concurrency. */
class ScriptedSTT implements STTEngine {
  readonly id = 'stt'
  readonly name = 'stt'
  readonly isOffline = true
  calls = 0
  active = 0
  maxActive = 0
  gates: Deferred<void>[] = []
  constructor(private readonly respond: (call: number) => STTResult | null | Error) {}
  async initialize(): Promise<void> {}
  async processAudio(): Promise<STTResult | null> {
    const call = this.calls++
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      const gate = this.gates[call]
      if (gate) await gate.promise
      const r = this.respond(call)
      if (r instanceof Error) throw r
      return r
    } finally {
      this.active--
    }
  }
  async dispose(): Promise<void> {}
}

class ControlledTranslator implements TranslatorEngine {
  readonly id = 'tr'
  readonly name = 'tr'
  readonly isOffline = true
  calls: string[] = []
  pending: Deferred<string>[] = []
  constructor(private readonly mode: 'immediate' | 'deferred' = 'immediate') {}
  async initialize(): Promise<void> {}
  async translate(text: string): Promise<string> {
    this.calls.push(text)
    if (this.mode === 'deferred') {
      const d = deferred<string>()
      this.pending.push(d)
      return d.promise
    }
    return `T(${text})`
  }
  async dispose(): Promise<void> {}
}

async function makePipeline(sttEngine: STTEngine, translator: TranslatorEngine) {
  const pipeline = new TranslationPipeline()
  pipeline.registerSTT('stt', () => sttEngine)
  pipeline.registerTranslator('tr', () => translator)
  await pipeline.switchEngine({ mode: 'cascade', sttEngineId: 'stt', translatorEngineId: 'tr' })
  pipeline.start()
  const finals: TranslationResult[] = []
  const interims: TranslationResult[] = []
  const errors: Error[] = []
  const states: string[] = []
  pipeline.on('result', (r: TranslationResult) => finals.push(r))
  pipeline.on('interim-result', (r: TranslationResult) => interims.push(r))
  pipeline.on('error', (e: Error) => errors.push(e))
  pipeline.on('state-change', (s: string) => states.push(s))
  return { pipeline, finals, interims, errors, states }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('one utterance, one final', () => {
  it('finalizing the same segment twice emits a single result', async () => {
    const engine = new ScriptedSTT(() => stt('hello world'))
    const { pipeline, finals } = await makePipeline(engine, new ControlledTranslator())

    await Promise.all([
      pipeline.finalizeStreaming(speech(), 16000, 's1'),
      pipeline.finalizeStreaming(speech(), 16000, 's1')
    ])

    expect(finals).toHaveLength(1)
    expect(finals[0].segmentId).toBe('s1')
    await pipeline.dispose()
  })

  it('finals of different segments are all emitted, in order, one STT call at a time', async () => {
    const engine = new ScriptedSTT((call) => stt(`utterance ${call}`))
    engine.gates[0] = deferred<void>()
    const { pipeline, finals } = await makePipeline(engine, new ControlledTranslator())

    const done = Promise.all([
      pipeline.finalizeStreaming(speech(), 16000, 's1'),
      pipeline.finalizeStreaming(speech(), 16000, 's2'),
      pipeline.finalizeStreaming(speech(), 16000, 's3')
    ])
    await flush()
    engine.gates[0].resolve()
    await done

    expect(finals.map((r) => r.segmentId)).toEqual(['s1', 's2', 's3'])
    expect(engine.maxActive).toBe(1)
    await pipeline.dispose()
  })

  it('a final submitted while an interim is in flight is not lost', async () => {
    const engine = new ScriptedSTT(() => stt('partial words here'))
    engine.gates[0] = deferred<void>()
    const { pipeline, finals } = await makePipeline(engine, new ControlledTranslator())

    const interim = pipeline.processStreaming(speech(), 16000, 's1')
    const final = pipeline.finalizeStreaming(speech(), 16000, 's1')
    await flush()
    engine.gates[0].resolve()
    await Promise.all([interim, final])

    expect(finals).toHaveLength(1)
    expect(finals[0].segmentId).toBe('s1')
    await pipeline.dispose()
  })
})

describe('late interim results never overwrite a final', () => {
  it('drops a debounced interim translation that resolves after the segment was finalized', async () => {
    vi.useFakeTimers()
    const engine = new ScriptedSTT(() => stt('good morning everyone'))
    const translator = new ControlledTranslator('deferred')
    const { pipeline, finals, interims } = await makePipeline(engine, translator)

    await pipeline.processStreaming(speech(), 16000, 's1')
    vi.advanceTimersByTime(1500)
    expect(translator.pending).toHaveLength(1)

    const final = pipeline.finalizeStreaming(speech(), 16000, 's1')
    await vi.waitFor(() => expect(translator.pending).toHaveLength(2))
    translator.pending[1].resolve('FINAL')
    await final
    expect(finals.map((r) => r.translatedText)).toEqual(['FINAL'])

    const interimCountAtFinal = interims.length
    translator.pending[0].resolve('LATE')
    await flush()

    expect(interims.slice(interimCountAtFinal)).toEqual([])
    await pipeline.dispose()
  })

  it('an interim for a new segment does not carry the previous segment translation', async () => {
    vi.useFakeTimers()
    const engine = new ScriptedSTT((call) => stt(call === 0 ? 'first sentence here' : 'second one'))
    const translator = new ControlledTranslator('immediate')
    const { pipeline, interims } = await makePipeline(engine, translator)

    await pipeline.processStreaming(speech(), 16000, 's1')
    await vi.advanceTimersByTimeAsync(1500)
    expect(interims.some((r) => r.translatedText === 'T(first sentence here)')).toBe(true)

    await pipeline.processStreaming(speech(), 16000, 's2')
    const s2 = interims.filter((r) => r.segmentId === 's2')
    expect(s2.length).toBeGreaterThan(0)
    expect(s2.every((r) => r.translatedText === '')).toBe(true)
    await pipeline.dispose()
  })
})

describe('STT failures surface instead of being swallowed', () => {
  it('reports each failed final and recovers after repeated failures', async () => {
    vi.useFakeTimers()
    const engine = new ScriptedSTT(() => new Error('native addon crashed'))
    const { pipeline, errors, states } = await makePipeline(engine, new ControlledTranslator())

    for (const id of ['s1', 's2', 's3']) {
      await pipeline.finalizeStreaming(speech(), 16000, id)
    }

    expect(errors.length).toBeGreaterThanOrEqual(3)
    expect(states).toContain(PipelineState.RECOVERING)
    await pipeline.dispose()
  })
})

describe('translation cache', () => {
  it('reuses a final translation and drops it when the glossary changes', async () => {
    const engine = new ScriptedSTT(() => stt('deploy the release'))
    const translator = new ControlledTranslator('immediate')
    const { pipeline, finals } = await makePipeline(engine, translator)

    await pipeline.finalizeStreaming(speech(), 16000, 's1')
    await pipeline.finalizeStreaming(speech(), 16000, 's2')
    expect(translator.calls).toHaveLength(1)

    pipeline.setGlossary([{ source: 'release', target: 'リリース' }])
    await pipeline.finalizeStreaming(speech(), 16000, 's3')
    expect(translator.calls).toHaveLength(2)
    expect(finals).toHaveLength(3)
    await pipeline.dispose()
  })
})
