import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type {
  STTBenchmarkEngine,
  STTBenchmarkResult,
  STTEngineSummary,
  STTSentenceResult,
  STTTestEntry
} from './stt-types.js'
import { computeWER, aggregateWER } from './wer.js'
import { measureLatency, snapshotMemory, tryGC, computeStats } from './metrics.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TESTSET_DIR = join(__dirname, '..', 'testset', 'stt')
const MANIFEST_PATH = join(TESTSET_DIR, 'manifest.jsonl')
const WARMUP_COUNT = 2

/** Load STT test entries from manifest JSONL */
function loadManifest(path: string): STTTestEntry[] {
  const content = readFileSync(path, 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as STTTestEntry)
}

/** Run a single STT engine against the full testset */
async function runSTTEngine(
  engine: STTBenchmarkEngine,
  entries: STTTestEntry[],
  testsetDir: string
): Promise<STTEngineSummary> {
  console.log(`\n[stt-runner] ${engine.label}: ${entries.length} audio files`)

  // Initialize
  console.log(`[stt-runner] Initializing ${engine.label}...`)
  await engine.initialize()
  tryGC()

  let peakRss = snapshotMemory().rssMB

  // Warmup (first N files, results discarded)
  const warmupEntries = entries.slice(0, WARMUP_COUNT)
  console.log(`[stt-runner] Warmup: ${warmupEntries.length} files`)
  for (const entry of warmupEntries) {
    try {
      const audioPath = join(testsetDir, entry.audio_path)
      await engine.transcribe(audioPath, entry.language)
    } catch {
      // Ignore warmup errors
    }
  }
  tryGC()

  // Benchmark all files
  const results: STTSentenceResult[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const audioPath = join(testsetDir, entry.audio_path)
    const progress = `[${i + 1}/${entries.length}]`

    try {
      const { result: output, ms } = await measureLatency(() =>
        engine.transcribe(audioPath, entry.language)
      )

      results.push({
        id: entry.id,
        audioPath: entry.audio_path,
        reference: entry.reference_text,
        output,
        language: entry.language,
        domain: entry.domain,
        latencyMs: ms
      })

      if ((i + 1) % 10 === 0) {
        console.log(`  ${progress} ${ms.toFixed(0)}ms — "${output.slice(0, 50)}"`)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`  ${progress} ERROR: ${errorMsg}`)
      results.push({
        id: entry.id,
        audioPath: entry.audio_path,
        reference: entry.reference_text,
        output: '',
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

  // Compute WER
  const successResults = results.filter((r) => !r.error)
  const werResults = successResults.map((r) => computeWER(r.reference, r.output, r.language))
  const overallWER = aggregateWER(werResults)

  // WER by language
  const werByLanguage: Record<string, ReturnType<typeof aggregateWER>> = {}
  const languages = [...new Set(entries.map((e) => e.language))]
  for (const lang of languages) {
    const langResults = successResults
      .filter((r) => r.language === lang)
      .map((r) => computeWER(r.reference, r.output, r.language))
    werByLanguage[lang] = aggregateWER(langResults)
  }

  const latencies = successResults.map((r) => r.latencyMs)

  return {
    engineId: engine.id,
    engineLabel: engine.label,
    totalFiles: entries.length,
    errors: results.filter((r) => r.error).length,
    latency: computeStats(latencies),
    wer: overallWER,
    werByLanguage,
    peakRssMB: peakRss,
    results
  }
}

/** Run the full STT benchmark suite */
export async function runSTTBenchmark(
  engines: STTBenchmarkEngine[]
): Promise<STTBenchmarkResult> {
  const entries = loadManifest(MANIFEST_PATH)
  console.log(`[stt-runner] Loaded ${entries.length} test entries from manifest`)

  const summaries: STTEngineSummary[] = []

  for (const engine of engines) {
    try {
      const summary = await runSTTEngine(engine, entries, TESTSET_DIR)
      summaries.push(summary)
    } catch (err) {
      console.error(`[stt-runner] Fatal error with ${engine.label}:`, err)
    } finally {
      try {
        await engine.dispose()
      } catch (err) {
        console.error(`[stt-runner] Dispose error for ${engine.label}:`, err)
      }
      tryGC()
    }
  }

  return {
    timestamp: new Date().toISOString(),
    summaries
  }
}
