import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type {
  BenchmarkEngine,
  BenchmarkResult,
  EngineSummary,
  SentenceResult,
  TestSentence,
  Direction
} from './types.js'
import { measureLatency, snapshotMemory, tryGC, computeStats } from './metrics.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TESTSET_PATH = join(__dirname, '..', 'testset', 'ja-en-100.jsonl')
const WARMUP_COUNT = 3

/** Load test sentences from JSONL file */
function loadTestSet(path: string): TestSentence[] {
  const content = readFileSync(path, 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TestSentence)
}

/** Run a single engine against the full testset */
async function runEngine(
  engine: BenchmarkEngine,
  sentences: TestSentence[],
  direction: Direction
): Promise<EngineSummary> {
  const filtered = sentences.filter((s) => s.direction === direction)
  console.log(`\n[runner] ${engine.label} (${direction}): ${filtered.length} sentences`)

  // Initialize
  console.log(`[runner] Initializing ${engine.label}...`)
  await engine.initialize()
  tryGC()

  const memBefore = snapshotMemory()
  let peakRss = memBefore.rssMB

  // Warmup (first N sentences, results discarded)
  const warmupSentences = filtered.slice(0, WARMUP_COUNT)
  console.log(`[runner] Warmup: ${warmupSentences.length} sentences`)
  for (const s of warmupSentences) {
    try {
      await engine.translate(s.source, direction)
    } catch {
      // Ignore warmup errors
    }
  }
  tryGC()

  // Benchmark all sentences
  const results: SentenceResult[] = []
  for (let i = 0; i < filtered.length; i++) {
    const sentence = filtered[i]!
    const progress = `[${i + 1}/${filtered.length}]`

    try {
      const { result: output, ms } = await measureLatency(() =>
        engine.translate(sentence.source, direction)
      )

      const mem = snapshotMemory()
      results.push({
        id: sentence.id,
        source: sentence.source,
        reference: sentence.reference,
        output,
        direction: sentence.direction,
        domain: sentence.domain,
        length: sentence.length,
        latencyMs: ms,
        inputCharCount: sentence.source.length,
        rssMB: mem.rssMB
      })

      if ((i + 1) % 10 === 0) {
        console.log(`  ${progress} ${ms.toFixed(0)}ms inputLen=${sentence.source.length} rss=${mem.rssMB.toFixed(0)}MB`)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`  ${progress} ERROR: ${errorMsg}`)
      const mem = snapshotMemory()
      results.push({
        id: sentence.id,
        source: sentence.source,
        reference: sentence.reference,
        output: '',
        direction: sentence.direction,
        domain: sentence.domain,
        length: sentence.length,
        latencyMs: 0,
        inputCharCount: sentence.source.length,
        rssMB: mem.rssMB,
        error: errorMsg
      })
    }

    // Track peak RSS
    const mem = snapshotMemory()
    if (mem.rssMB > peakRss) peakRss = mem.rssMB
  }

  const latencies = results.filter((r) => !r.error).map((r) => r.latencyMs)
  const errors = results.filter((r) => r.error).length

  return {
    engineId: engine.id,
    engineLabel: engine.label,
    direction,
    totalSentences: filtered.length,
    errors,
    latency: computeStats(latencies),
    peakRssMB: peakRss,
    results
  }
}

/** Run the full benchmark suite */
export async function runBenchmark(
  engines: BenchmarkEngine[],
  directions: Direction[] = ['ja-en', 'en-ja']
): Promise<BenchmarkResult> {
  const sentences = loadTestSet(TESTSET_PATH)
  console.log(`[runner] Loaded ${sentences.length} test sentences`)

  const summaries: EngineSummary[] = []

  for (const engine of engines) {
    for (const direction of directions) {
      try {
        const summary = await runEngine(engine, sentences, direction)
        summaries.push(summary)
      } catch (err) {
        console.error(`[runner] Fatal error with ${engine.label} (${direction}):`, err)
      } finally {
        try {
          await engine.dispose()
        } catch (err) {
          console.error(`[runner] Dispose error for ${engine.label}:`, err)
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
