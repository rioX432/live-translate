/**
 * Dev shadow harness (#730) — the "第0歩" measurement.
 *
 * Runs the JA⇄EN audio testset through the local cascade and writes a
 * ShadowReport, so decisions rest on measured latency rather than on intuition.
 *
 * DEV ONLY. Gated behind an env flag and refused in packaged builds. It must run inside Electron main — the cascade's real engines need utilityProcess
 * (worker pool) and app.getPath('userData') (model resolution), which is exactly
 * why measuring the benchmark/ package's separate engine copies would prove nothing
 * about production.
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { ShadowRunner } from '../../pipeline/shadow/ShadowRunner'
import { CascadeShadowPath } from '../../pipeline/shadow/paths/CascadeShadowPath'
import type { ShadowReport } from '../../pipeline/shadow/metrics'
import { WhisperLocalEngine } from '../../engines/stt/WhisperLocalEngine'
import { Qwen3ASREngine } from '../../engines/stt/Qwen3ASREngine'
import { HyMT2Translator } from '../../engines/translator/HyMT2Translator'
import { selectEngines } from '../../engines/engine-selection'
import type { Language, STTEngine } from '../../engines/types'
import { createLogger } from '../logger'
import { readWav } from './wav'

const log = createLogger('shadow-harness')

const DEFAULT_TESTSET_DIR = 'benchmark/testset'
const MANIFEST_NAME = 'stt-manifest.jsonl'

interface ManifestEntry {
  id: string
  audio_path: string
  reference_text: string
  language: Language
  domain: string
}

export interface ShadowHarnessOptions {
  /** Root of the testset (contains stt-manifest.jsonl + stt-audio/). */
  testsetDir?: string
  /** Where the report JSON is written. */
  outPath?: string
  /** Limit the number of utterances (smoke runs). */
  limit?: number
}

function loadManifest(testsetDir: string, limit?: number): ManifestEntry[] {
  const manifestPath = join(testsetDir, MANIFEST_NAME)
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Testset manifest not found at ${manifestPath}. The audio set is gitignored — regenerate it with "npm run bench:stt:generate".`
    )
  }
  const entries = readFileSync(manifestPath, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ManifestEntry)
  return limit ? entries.slice(0, limit) : entries
}

/**
 * Run one utterance through the cascade and throw the result away, so lazy model
 * load / shader compilation is not billed to the first measured segment.
 */
async function warmupCascade(
  cascade: CascadeShadowPath,
  entries: ManifestEntry[],
  testsetDir: string
): Promise<void> {
  const first = entries.find((e) => existsSync(join(testsetDir, e.audio_path)))
  if (!first) return
  const { samples, sampleRate } = readWav(join(testsetDir, first.audio_path))
  log.info('Warming up cascade engines...')
  try {
    await cascade.process(samples, sampleRate, new AbortController().signal)
  } catch (err) {
    log.warn('Cascade warmup failed (continuing):', err)
  }
}

export async function runShadowJaEnHarness(options: ShadowHarnessOptions = {}): Promise<ShadowReport> {
  if (app.isPackaged) {
    throw new Error('The shadow harness is a development tool and is disabled in packaged builds.')
  }
  const testsetDir = resolve(options.testsetDir ?? DEFAULT_TESTSET_DIR)
  const entries = loadManifest(testsetDir, options.limit)
  log.info(`Loaded ${entries.length} utterances from ${testsetDir}`)

  const onProgress = (msg: string): void => log.info(msg)
  const stt: STTEngine = selectEngines(process.platform, process.arch).sttEngine === 'qwen3-asr'
    ? new Qwen3ASREngine({ onProgress })
    : new WhisperLocalEngine({ onProgress })
  const translator = new HyMT2Translator({ onProgress })
  const cascade = new CascadeShadowPath({
    stt,
    translator,
    // Hy-MT2 runs in the shared slm-worker UtilityProcess.
    usesLocalLlm: true
  })

  log.info('Initializing cascade engines (may download models)...')
  await stt.initialize()
  await translator.initialize()

  const runner = new ShadowRunner()
  // Measure every segment on both paths: the runner's local-LLM defaults thin out
  // sampling for live use, but this is an offline run over a fixed set where each
  // utterance is submitted only after the previous one has drained.
  runner.register(cascade, { enabled: true, samplingInterval: 1, permits: 1 })

  // Warm the cascade on a throwaway inference before measuring. Lazy model load
  // and Metal shader compilation land entirely on the first utterance otherwise
  // (measured: 16.3s vs a 2.2s steady-state median), which shows up as a p95
  // that describes startup rather than the path.
  await warmupCascade(cascade, entries, testsetDir)

  runner.start()
  try {
    for (const entry of entries) {
      const wavPath = join(testsetDir, entry.audio_path)
      if (!existsSync(wavPath)) {
        log.warn(`Skipping ${entry.id}: audio missing at ${wavPath}`)
        continue
      }
      const { samples, sampleRate } = readWav(wavPath)

      runner.submit(samples, sampleRate)
      // Submit strictly one at a time: the runner drops-if-busy, so overlapping
      // utterances would be recorded as busy drops instead of measurements.
      await runner.whenIdle()
      log.info(`Measured ${entry.id} (${entry.language})`)
    }
  } finally {
    await runner.stop()
    await translator.dispose().catch(() => undefined)
    await stt.dispose().catch(() => undefined)
  }

  const report = runner.getReport()
  const outPath = resolve(options.outPath ?? join('benchmark', 'results', 'shadow-ja-en.json'))
  mkdirSync(join(outPath, '..'), { recursive: true })
  // Raw samples ride along with the summary, which cannot show WHICH utterance
  // produced an outlier. They carry no transcript — ShadowSample records counts
  // only, and reference-based quality stays in the offline benchmark by design.
  writeFileSync(
    outPath,
    JSON.stringify({ ...report, samples: runner.getSamples(), errors: runner.getErrors() }, null, 2)
  )
  log.info(`Wrote shadow report to ${outPath}`)
  return report
}
