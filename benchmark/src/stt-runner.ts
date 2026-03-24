import { readFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type {
  STTBenchmarkEngine,
  STTBenchmarkResult,
  STTEngineSummary,
  STTSentenceResult,
  STTTestEntry,
  STTLanguage,
  AccuracyStats
} from './stt-types.js'
import type { LatencyStats } from './types.js'
import { measureLatency, snapshotMemory, tryGC, computeStats } from './metrics.js'
import { computeErrorRate, aggregateAccuracy } from './wer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, '..', 'testset', 'stt-manifest.jsonl')
const WARMUP_COUNT = 2

/** Load STT test manifest from JSONL file */
function loadManifest(path: string): STTTestEntry[] {
  const content = readFileSync(path, 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as STTTestEntry)
}

/** Resolve audio path relative to testset directory */
function resolveAudioPath(entry: STTTestEntry): string {
  return resolve(join(__dirname, '..', 'testset'), entry.audio_path)
}

/** Run a single STT engine against the test set for one language */
async function runSTTEngine(
  engine: STTBenchmarkEngine,
  entries: STTTestEntry[],
  language: STTLanguage | 'all'
): Promise<STTEngineSummary> {
  const filtered =
    language === 'all' ? entries : entries.filter((e) => e.language === language)

  console.log(
    `\n[stt-runner] ${engine.label} (${language}): ${filtered.length} audio files`
  )

  // Initialize
  console.log(`[stt-runner] Initializing ${engine.label}...`)
  await engine.initialize()
  tryGC()

  let peakRss = snapshotMemory().rssMB

  // Warmup
  const warmupEntries = filtered.slice(0, WARMUP_COUNT)
  console.log(`[stt-runner] Warmup: ${warmupEntries.length} files`)
  for (const entry of warmupEntries) {
    try {
      await engine.transcribe(resolveAudioPath(entry))
    } catch {
      // Ignore warmup errors
    }
  }
  tryGC()

  // Benchmark all entries
  const results: STTSentenceResult[] = []
  const accuracyStats: AccuracyStats[] = []

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i]!
    const progress = `[${i + 1}/${filtered.length}]`
    const audioPath = resolveAudioPath(entry)

    try {
      const { result: transcription, ms } = await measureLatency(() =>
        engine.transcribe(audioPath)
      )

      const hypothesis = transcription.text

      // Compute error rate
      const accuracy = computeErrorRate(entry.reference_text, hypothesis, entry.language)
      accuracyStats.push(accuracy)

      results.push({
        id: entry.id,
        reference: entry.reference_text,
        hypothesis,
        language: entry.language,
        domain: entry.domain,
        latencyMs: ms
      })

      if ((i + 1) % 5 === 0 || i === filtered.length - 1) {
        const errPct = (accuracy.errorRate * 100).toFixed(1)
        console.log(
          `  ${progress} ${ms.toFixed(0)}ms | ER=${errPct}% | "${hypothesis.substring(0, 40)}..."`
        )
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`  ${progress} ERROR: ${errorMsg}`)
      results.push({
        id: entry.id,
        reference: entry.reference_text,
        hypothesis: '',
        language: entry.language,
        domain: entry.domain,
        latencyMs: 0,
        error: errorMsg
      })
    }

    // Track peak RSS
    const mem = snapshotMemory()
    if (mem.rssMB > peakRss) peakRss = mem.rssMB
  }

  const latencies = results.filter((r) => !r.error).map((r) => r.latencyMs)
  const errors = results.filter((r) => r.error).length
  const accuracy = aggregateAccuracy(accuracyStats)

  return {
    engineId: engine.id,
    engineLabel: engine.label,
    language,
    totalFiles: filtered.length,
    errors,
    accuracy,
    latency: computeStats(latencies),
    peakRssMB: peakRss,
    results
  }
}

/** Run the full STT benchmark suite */
export async function runSTTBenchmark(
  engines: STTBenchmarkEngine[],
  languages: (STTLanguage | 'all')[] = ['ja', 'en', 'all']
): Promise<STTBenchmarkResult> {
  const entries = loadManifest(MANIFEST_PATH)
  console.log(`[stt-runner] Loaded ${entries.length} test entries from manifest`)

  const summaries: STTEngineSummary[] = []

  for (const engine of engines) {
    for (const language of languages) {
      try {
        const summary = await runSTTEngine(engine, entries, language)
        summaries.push(summary)
      } catch (err) {
        console.error(
          `[stt-runner] Fatal error with ${engine.label} (${language}):`,
          err
        )
      } finally {
        try {
          await engine.dispose()
        } catch (err) {
          console.error(`[stt-runner] Dispose error for ${engine.label}:`, err)
        }
        tryGC()
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    summaries
  }
}
