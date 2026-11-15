/**
 * 1x-speed E2E run of the real TranslationPipeline.
 *
 * Audio is fed frame by frame on the wall clock through the renderer's VAD and
 * rolling-buffer logic on a separate thread (feeder-worker.ts), then through the
 * main process's audio-port gating, so subtitle timing matches what a user sees.
 *
 * Build: node benchmark/e2e/build.mjs run-e2e.ts feeder-worker.ts
 * Usage:
 *   node dist/run-e2e.js --session <session.json> --stt <id> --mt <id> --out <dir>
 *     [--glossary <json>] [--hotwords <json>] [--finalize app|queue] [--tag <name>] [--maxSec <n>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join, basename } from 'path'
import { performance } from 'perf_hooks'
import { Worker } from 'worker_threads'
import { TranslationPipeline } from '../../src/pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../../src/engines/stt/WhisperLocalEngine'
import { AppleSpeechTranscriberEngine } from '../../src/engines/stt/AppleSpeechTranscriberEngine'
import { HunyuanMT15Translator } from '../../src/engines/translator/HunyuanMT15Translator'
import type { GlossaryEntry, STTEngine, TranslationResult } from '../../src/engines/types'
import { HyMT2Translator } from './engines/HyMT2Translator'
import { Qwen3AsrMlxEngine } from './engines/Qwen3AsrMlxEngine'
import type { MemSummary } from './mem-sampler'
import type { FeederMsg } from './feeder-worker'
import { SAMPLE_RATE } from './vad-node'

// Values from src/main/audio-constants.ts.
const MIN_AUDIO_CHUNK_SAMPLES = 8000
const SILENCE_THRESHOLD = 0.001
/** How long to keep listening after the last frame for late finals and debounced interims. */
const DRAIN_MS = 8000

type Args = Record<string, string>
function parseArgs(argv: string[]): Args {
  const a: Args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]
  }
  return a
}

const PY = process.env.LT_BENCH_PYTHON ?? 'python3'

function makeStt(id: string, hotwords: string[] | undefined): STTEngine {
  switch (id) {
    case 'whisper-turbo':
      return new WhisperLocalEngine({ modelVariant: 'large-v3-turbo' })
    case 'qwen3-0.6b':
      return new Qwen3AsrMlxEngine({ python: PY, model: 'mlx-community/Qwen3-ASR-0.6B-8bit', hotwords, id })
    case 'qwen3-1.7b':
      return new Qwen3AsrMlxEngine({ python: PY, model: 'mlx-community/Qwen3-ASR-1.7B-4bit', hotwords, id })
    case 'apple-ja':
    case 'apple-en': {
      const e = new AppleSpeechTranscriberEngine({ locale: id === 'apple-ja' ? 'ja-JP' : 'en-US' })
      // The product binary under scripts/apple-stt does not build on Xcode 27.1; the
      // bench points the engine at a patched build instead of changing the product.
      const bin = process.env.LT_BENCH_APPLE_STT
      if (!bin) throw new Error('LT_BENCH_APPLE_STT is required for apple-* engines')
      ;(e as unknown as { binaryPath: string }).binaryPath = bin
      return e
    }
    default:
      throw new Error(`unknown stt ${id}`)
  }
}

function makeMt(id: string): HunyuanMT15Translator | HyMT2Translator {
  if (id === 'hy-mt15') return new HunyuanMT15Translator()
  if (id === 'hy-mt2') return new HyMT2Translator()
  throw new Error(`unknown mt ${id}`)
}

interface BenchEvent {
  t: number // seconds since the feeder processed the first frame
  kind: string
  seg?: number
  [k: string]: unknown
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const sessionPath = args.session
  const meta = JSON.parse(readFileSync(sessionPath, 'utf8'))
  const raw = readFileSync(join(dirname(sessionPath), `${meta.name}.f32`))
  const full = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  // --maxSec truncates the session for smoke runs; scoring ignores utterances past the cut.
  const audio = args.maxSec ? full.subarray(0, Math.floor(Number(args.maxSec) * SAMPLE_RATE)) : full
  const glossary: GlossaryEntry[] = args.glossary ? JSON.parse(readFileSync(args.glossary, 'utf8')) : []
  const hotwords: string[] | undefined = args.hotwords ? JSON.parse(readFileSync(args.hotwords, 'utf8')) : undefined
  const finalizePolicy = args.finalize ?? 'queue'
  const tag = args.tag ?? `${args.stt}+${args.mt}`
  const outDir = args.out
  mkdirSync(outDir, { recursive: true })

  // Audio goes to the feeder thread through shared memory; that thread also samples memory.
  const shared = new SharedArrayBuffer(audio.byteLength)
  new Float32Array(shared).set(audio)
  const feeder = new Worker(join(__dirname, 'feeder-worker.js'), { workerData: { audio: shared } })

  const pipeline = new TranslationPipeline()
  const stt = makeStt(args.stt, hotwords)
  pipeline.registerSTT(args.stt, () => stt)
  const mt = makeMt(args.mt)
  pipeline.registerTranslator(args.mt, () => mt)
  const tLoad0 = performance.now()
  await pipeline.switchEngine({ mode: 'cascade', sttEngineId: args.stt, translatorEngineId: args.mt })
  const loadMs = performance.now() - tLoad0

  // The first whisper.cpp call compiles Metal kernels (7-9 s, blocking the main thread)
  // and the first LLM call is ~4x slower than later ones. Measured separately so the
  // session numbers reflect a warmed-up app; the cold cost is reported as warmupMs.
  const tWarm0 = performance.now()
  const noise = new Float32Array(SAMPLE_RATE * 2).map(() => (Math.random() - 0.5) * 0.01)
  await stt.processAudio(noise, SAMPLE_RATE)
  const sttWarmMs = performance.now() - tWarm0
  await mt.translate('来週の定例は火曜日に変更します。', 'ja', 'en')
  await mt.translate('Please review the build before release.', 'en', 'ja')
  const warmupMs = { stt: Math.round(sttWarmMs), mt: Math.round(performance.now() - tWarm0 - sttWarmMs) }
  pipeline.setLanguageConfig('auto', 'en')
  if (glossary.length) pipeline.setGlossary(glossary)
  pipeline.start()

  const events: BenchEvent[] = []
  let tStart = 0
  const epochMs = (): number => performance.timeOrigin + performance.now()
  const sec = (epoch: number): number => (epoch - tStart) / 1000
  let seg = -1
  const counters = { streamSent: 0, streamDropBusy: 0, streamGated: 0, finalizeSent: 0, finalizeWouldDrop: 0, finalizeGated: 0, legacySkipped: 0 }

  // Finalize handling. 'app' reproduces audio-port's drop-if-busy; 'queue' keeps every
  // finalize (bench workaround) and counts the ones the app would have dropped.
  let finalizeBusy = false
  let finalizingSeg = -1
  const finalizeQueue: { seg: number; chunk: Float32Array }[] = []
  let finalizeIdle: Promise<void> = Promise.resolve()

  pipeline.on('interim-result', (r: TranslationResult) => {
    events.push({ t: sec(epochMs()), kind: 'interim', seg, src: r.sourceText, tr: r.translatedText, lang: r.sourceLanguage, tgt: r.targetLanguage })
  })
  pipeline.on('result', (r: TranslationResult) => {
    events.push({ t: sec(epochMs()), kind: 'final', seg: finalizingSeg, src: r.sourceText, tr: r.translatedText, lang: r.sourceLanguage, tgt: r.targetLanguage })
  })
  pipeline.on('error', (e: Error) => events.push({ t: sec(epochMs()), kind: 'error', seg, msg: String(e?.message ?? e) }))

  const passesGate = (chunk: Float32Array): boolean => {
    if (chunk.length < MIN_AUDIO_CHUNK_SAMPLES) return false
    let maxAmp = 0
    for (let i = 0; i < chunk.length; i++) maxAmp = Math.max(maxAmp, Math.abs(chunk[i]))
    return maxAmp >= SILENCE_THRESHOLD
  }

  let streamingBusy = false
  const sendStreaming = (chunk: Float32Array, sentAt: number): void => {
    if (!passesGate(chunk)) { counters.streamGated++; return }
    if (streamingBusy) { counters.streamDropBusy++; return }
    streamingBusy = true
    counters.streamSent++
    events.push({ t: sec(epochMs()), kind: 'stream-send', seg, sentAt: sec(sentAt), sec: chunk.length / SAMPLE_RATE })
    pipeline.processStreaming(chunk, SAMPLE_RATE).catch(() => undefined).finally(() => { streamingBusy = false })
  }

  const runFinalizeQueue = async (): Promise<void> => {
    while (finalizeQueue.length) {
      const job = finalizeQueue[0]
      finalizeBusy = true
      finalizingSeg = job.seg
      events.push({ t: sec(epochMs()), kind: 'finalize-start', seg: job.seg })
      await pipeline.finalizeStreaming(job.chunk, SAMPLE_RATE).catch(() => undefined)
      events.push({ t: sec(epochMs()), kind: 'finalize-done', seg: job.seg })
      finalizeQueue.shift()
      finalizeBusy = false
    }
  }
  const sendFinalize = (chunk: Float32Array, s: number): void => {
    if (!passesGate(chunk)) { counters.finalizeGated++; return }
    if (finalizeBusy) {
      counters.finalizeWouldDrop++
      events.push({ t: sec(epochMs()), kind: 'finalize-would-drop', seg: s })
      if (finalizePolicy === 'app') return
    }
    counters.finalizeSent++
    finalizeQueue.push({ seg: s, chunk })
    if (!finalizeBusy && finalizeQueue.length === 1) finalizeIdle = runFinalizeQueue()
  }

  let maxLagMs = 0
  let feedEnd = 0
  const fed = new Promise<void>((resolve) => {
    feeder.on('message', (m: FeederMsg) => {
      switch (m.type) {
        case 'started':
          tStart = m.t
          break
        case 'vad-start':
          seg++
          events.push({ t: sec(m.t), kind: 'vad-start', seg, recvAt: sec(epochMs()) })
          break
        case 'vad-end':
          events.push({ t: sec(m.t), kind: 'vad-end', seg, recvAt: sec(epochMs()), sec: m.audio.length / SAMPLE_RATE })
          sendFinalize(m.audio, seg)
          // The renderer also sends the same audio as legacy 'process-audio', which would run
          // pipeline.process() and emit a second final for the same speech. Skipped here.
          counters.legacySkipped++
          break
        case 'vad-misfire':
          events.push({ t: sec(m.t), kind: 'vad-misfire', seg })
          break
        case 'stream':
          sendStreaming(m.chunk, m.t)
          break
        case 'done':
          maxLagMs = m.maxLagMs
          feedEnd = sec(m.t)
          resolve()
          break
      }
    })
  })
  feeder.postMessage({ type: 'start' })
  await fed
  await finalizeIdle
  await new Promise((r) => setTimeout(r, DRAIN_MS))
  await pipeline.stop()
  const memSummary = await new Promise<MemSummary>((resolve) => {
    feeder.on('message', (m: FeederMsg) => {
      if (m.type === 'mem') resolve(m.summary as MemSummary)
    })
    feeder.postMessage({ type: 'stop-mem' })
  })
  await feeder.terminate()
  await pipeline.dispose()

  const sttCallMs = stt instanceof Qwen3AsrMlxEngine ? stt.callMs : undefined
  const out = {
    tag,
    session: meta.name,
    stt: args.stt,
    mt: args.mt,
    finalizePolicy,
    glossary: glossary.length,
    hotwords: hotwords?.length ?? 0,
    loadMs: Math.round(loadMs),
    warmupMs,
    audioSec: audio.length / SAMPLE_RATE,
    feedEndSec: feedEnd,
    maxFeedLagMs: Math.round(maxLagMs),
    counters,
    mem: memSummary,
    sttCallMs,
    events
  }
  const file = join(outDir, `${tag}__${basename(meta.name)}.json`)
  writeFileSync(file, JSON.stringify(out))
  console.log(`RESULT ${file} load=${out.loadMs}ms warm=${JSON.stringify(warmupMs)} feedLag=${out.maxFeedLagMs}ms ${JSON.stringify(counters)} peakRss=${(memSummary.peakRssBytes / 1e9).toFixed(2)}GB peakFp=${(memSummary.peakFootprintBytes / 1e9).toFixed(2)}GB`)
  // whisper-node-addon aborts in a static destructor on exit ("mutex lock failed");
  // the result is already written, so exit code 134 after RESULT is not a run failure.
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
