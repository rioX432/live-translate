/**
 * Dev shadow harness (#730) — the "第0歩" measurement.
 *
 * Runs the JA⇄EN audio testset through the Local-first cascade and the cloud
 * realtime e2e path side by side and writes a ShadowReport, so the choice between
 * investing in cascade modernization (#725) and local e2e (#724) rests on measured
 * latency / cost / offline-completeness rather than on intuition.
 *
 * DEV ONLY. Gated behind an env flag, never reachable from the production UI: the
 * cloud path is BYOK and sends audio off-device, so it stays opt-in and explicit.
 * It must run inside Electron main — the cascade's real engines need utilityProcess
 * (worker pool) and app.getPath('userData') (model resolution), which is exactly
 * why measuring the benchmark/ package's separate engine copies would prove nothing
 * about production.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { ShadowRunner } from '../../pipeline/shadow/ShadowRunner'
import { CascadeShadowPath } from '../../pipeline/shadow/paths/CascadeShadowPath'
import { E2EStreamingShadowPath } from '../../pipeline/shadow/paths/E2EStreamingShadowPath'
import type { ShadowReport } from '../../pipeline/shadow/metrics'
import { WhisperLocalEngine } from '../../engines/stt/WhisperLocalEngine'
import type { WhisperVariant } from '../../engines/model-downloader'
import { HunyuanMT15Translator } from '../../engines/translator/HunyuanMT15Translator'
import { CloudRealtimeE2E } from '../../engines/e2e/CloudRealtimeE2E'
import type { Language } from '../../engines/types'
import { store } from '../store'
import { createLogger } from '../logger'
import { readWav } from './wav'

const log = createLogger('shadow-harness')

/** Published price of gpt-realtime-translate: $0.034 per audio minute. */
const GPT_REALTIME_TRANSLATE_USD_PER_AUDIO_MINUTE = 0.034

const DEFAULT_TESTSET_DIR = 'benchmark/testset'
const MANIFEST_NAME = 'stt-manifest.jsonl'
/** Bilingual variant — see ShadowHarnessOptions.whisperVariant. */
const DEFAULT_WHISPER_VARIANT: WhisperVariant = 'large-v3-turbo'

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
  /** Include the cloud path. Requires an OpenAI key; costs real money. */
  includeCloud?: boolean
  /**
   * Whisper variant for the cascade's STT stage. Must be bilingual: the engine's
   * own default (kotoba-whisper-v2.0) is JA-only and returns nothing for English,
   * which silently zeroes out half of a JA⇄EN comparison.
   */
  whisperVariant?: WhisperVariant
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
 * The cloud engine fixes its output language per session, so one session cannot
 * translate both directions. Each direction therefore gets its own path, and JA
 * and EN utterances are submitted in separate passes.
 */
function buildCloudPath(apiKey: string, sourceLanguage: Language): E2EStreamingShadowPath {
  const targetLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'
  return new E2EStreamingShadowPath({
    id: `cloud-realtime-e2e:${sourceLanguage}->${targetLanguage}`,
    engine: new CloudRealtimeE2E({ apiKey, sourceLanguage, targetLanguage }),
    cost: { usdPerAudioMinute: GPT_REALTIME_TRANSLATE_USD_PER_AUDIO_MINUTE }
  })
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
  const testsetDir = resolve(options.testsetDir ?? DEFAULT_TESTSET_DIR)
  const entries = loadManifest(testsetDir, options.limit)
  log.info(`Loaded ${entries.length} utterances from ${testsetDir}`)

  const apiKey = options.includeCloud ? store.get('openaiApiKey') : ''
  if (options.includeCloud && !apiKey) {
    throw new Error('Cloud path requested but no OpenAI API key is stored (BYOK).')
  }

  const stt = new WhisperLocalEngine({
    onProgress: (msg) => log.info(msg),
    modelVariant: options.whisperVariant ?? DEFAULT_WHISPER_VARIANT
  })
  const translator = new HunyuanMT15Translator({ onProgress: (msg) => log.info(msg) })
  const cascade = new CascadeShadowPath({
    stt,
    translator,
    // HY-MT1.5 runs in the shared slm-worker UtilityProcess.
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

  const cloudPaths = new Map<Language, E2EStreamingShadowPath>()
  if (apiKey) {
    for (const language of ['ja', 'en'] as Language[]) {
      const path = buildCloudPath(apiKey, language)
      cloudPaths.set(language, path)
      runner.register(path, { enabled: true, samplingInterval: 1, permits: 1 })
    }
    // Open the sockets up front so the first measured segment does not carry the
    // WebSocket handshake and skew its first-subtitle number.
    log.info('Warming up cloud sessions...')
    await Promise.all([...cloudPaths.values()].map((p) => p.warmup()))
  }

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

      // A cloud session translates into ONE fixed language, so only the path for
      // this utterance's direction may see it. Disable the other one for this
      // submit rather than recording a wrong-direction translation.
      for (const [language, path] of cloudPaths) {
        runner.setPathEnabled(path.id, language === entry.language)
      }

      runner.submit(samples, sampleRate)
      // Submit strictly one at a time: the runner drops-if-busy, so overlapping
      // utterances would be recorded as busy drops instead of measurements.
      await runner.whenIdle()
      log.info(`Measured ${entry.id} (${entry.language})`)
    }
  } finally {
    await runner.stop()
    await Promise.all([...cloudPaths.values()].map((p) => p.dispose().catch(() => undefined)))
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
