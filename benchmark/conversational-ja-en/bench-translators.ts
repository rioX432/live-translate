/**
 * Conversational JA<->EN translation benchmark.
 *
 * Compares LFM2, HY-MT1.5 (1.8B), Hunyuan-MT (7B), and Microsoft Translator
 * on a small (24-utterance) conversational dataset built from public
 * tech-conference talk themes (see data/utterances.json and README.md).
 *
 * Metrics:
 *   - chrF (character n-gram F-score) as a stand-in for COMET-22.
 *     See TODO in metrics.ts for COMET-22 future work.
 *   - Latency p50 / p95 / p99 per engine, per direction.
 *
 * Usage:
 *   npx tsx --expose-gc bench-translators.ts
 *   npx tsx --expose-gc bench-translators.ts --engines hunyuan-mt-15,microsoft
 *   npx tsx --expose-gc bench-translators.ts --direction ja-en
 *
 * Env vars (only required if running the corresponding engine):
 *   MICROSOFT_TRANSLATOR_KEY     - Azure Translator subscription key
 *   MICROSOFT_TRANSLATOR_REGION  - Azure Translator region (e.g. "japaneast")
 *
 * For backward compatibility the script also reads AZURE_TRANSLATOR_KEY /
 * AZURE_TRANSLATOR_REGION (already used by ../src/engines/microsoft.ts).
 *
 * Output:
 *   results/conversational-ja-en-<timestamp>.json   raw per-sentence results
 *   results/conversational-ja-en-<timestamp>.md     summary tables
 *   results/conversational-human-eval-<timestamp>.csv  10-sample subjective scoring sheet
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { BenchmarkEngine, Direction } from '../src/types.js'
import { chrF, percentile } from './metrics.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const RESULTS_DIR = join(__dirname, 'results')
const UTTERANCES_PATH = join(DATA_DIR, 'utterances.json')
const REFERENCES_PATH = join(DATA_DIR, 'reference-translations.json')

const SUBJECTIVE_SAMPLE_SIZE = 10
const TIMEOUT_PER_TRANSLATION_MS = 60_000

// ── Engine catalog ──

const AVAILABLE_ENGINES = [
  'lfm2',
  'hunyuan-mt-15',
  'hunyuan-mt',
  'microsoft'
] as const
type EngineId = (typeof AVAILABLE_ENGINES)[number]

/**
 * Engine factory. Returns null when the engine cannot be constructed (e.g.
 * missing API key or model file). Callers should skip nulls gracefully.
 */
async function createEngine(id: EngineId): Promise<BenchmarkEngine | null> {
  try {
    switch (id) {
      case 'lfm2': {
        // LFM2 has no dedicated bench adapter today; reuse translate-gemma
        // path is not appropriate. Skip with informative warning so the
        // bench still runs for the other engines.
        console.warn(
          '[bench] Engine "lfm2" is not yet wired in benchmark/src/engines/. ' +
            'Skipping. Add LFM2Bench adapter to evaluate.'
        )
        return null
      }
      case 'hunyuan-mt-15': {
        const { HunyuanMT15Bench } = await import('../src/engines/hunyuan-mt-15.js')
        return new HunyuanMT15Bench({ useGpu: true })
      }
      case 'hunyuan-mt': {
        const { HunyuanMTBench } = await import('../src/engines/hunyuan-mt.js')
        return new HunyuanMTBench({ useGpu: true })
      }
      case 'microsoft': {
        // Prefer MICROSOFT_TRANSLATOR_* env vars; fall back to AZURE_* for
        // compatibility with the existing microsoft adapter.
        const key =
          process.env.MICROSOFT_TRANSLATOR_KEY ?? process.env.AZURE_TRANSLATOR_KEY
        const region =
          process.env.MICROSOFT_TRANSLATOR_REGION ?? process.env.AZURE_TRANSLATOR_REGION
        if (!key || !region) {
          console.warn(
            '[bench] Engine "microsoft" requires MICROSOFT_TRANSLATOR_KEY and ' +
              'MICROSOFT_TRANSLATOR_REGION (or AZURE_TRANSLATOR_KEY / ' +
              'AZURE_TRANSLATOR_REGION). Skipping.'
          )
          return null
        }
        // The existing adapter reads AZURE_TRANSLATOR_* directly, so mirror
        // the MICROSOFT_* values into AZURE_* before construction.
        process.env.AZURE_TRANSLATOR_KEY = key
        process.env.AZURE_TRANSLATOR_REGION = region
        const { MicrosoftBench } = await import('../src/engines/microsoft.js')
        return new MicrosoftBench()
      }
    }
  } catch (err) {
    console.warn(
      `[bench] Failed to construct engine "${id}": ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return null
  }
}

// ── Dataset loading ──

interface Utterance {
  id: string
  source_lang: 'ja' | 'en'
  text: string
  domain: string
  source_kind: string
  source_inspiration: string
}

interface Reference {
  id: string
  target_lang: 'ja' | 'en'
  text: string
}

interface DatasetItem {
  id: string
  source: string
  reference: string
  direction: Direction
  domain: string
  source_inspiration: string
}

function loadDataset(): DatasetItem[] {
  if (!existsSync(UTTERANCES_PATH) || !existsSync(REFERENCES_PATH)) {
    throw new Error(
      `Dataset files missing under ${DATA_DIR}. ` +
        'Expected utterances.json and reference-translations.json.'
    )
  }

  const utterances = (
    JSON.parse(readFileSync(UTTERANCES_PATH, 'utf-8')) as {
      utterances: Utterance[]
    }
  ).utterances
  const references = (
    JSON.parse(readFileSync(REFERENCES_PATH, 'utf-8')) as {
      references: Reference[]
    }
  ).references

  const refById = new Map(references.map((r) => [r.id, r]))
  const items: DatasetItem[] = []
  for (const u of utterances) {
    const ref = refById.get(u.id)
    if (!ref) {
      console.warn(`[bench] Missing reference for utterance "${u.id}"; skipping.`)
      continue
    }
    const direction: Direction =
      u.source_lang === 'ja' && ref.target_lang === 'en'
        ? 'ja-en'
        : u.source_lang === 'en' && ref.target_lang === 'ja'
          ? 'en-ja'
          : (() => {
              throw new Error(
                `[bench] Inconsistent language pair for "${u.id}": ${u.source_lang} -> ${ref.target_lang}`
              )
            })()
    items.push({
      id: u.id,
      source: u.text,
      reference: ref.text,
      direction,
      domain: u.domain,
      source_inspiration: u.source_inspiration
    })
  }
  return items
}

// ── Per-engine evaluation ──

interface SentenceResult {
  id: string
  direction: Direction
  domain: string
  source: string
  reference: string
  output: string
  latencyMs: number
  chrF: number
  error?: string
}

interface EngineSummary {
  engineId: string
  engineLabel: string
  direction: Direction
  sampleCount: number
  errors: number
  meanChrF: number
  latency: { p50: number; p95: number; p99: number; min: number; max: number }
  results: SentenceResult[]
}

async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Translation timed out after ${ms}ms`)), ms)
    fn().then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function evaluateEngine(
  engine: BenchmarkEngine,
  items: DatasetItem[],
  direction: Direction
): Promise<EngineSummary> {
  const filtered = items.filter((i) => i.direction === direction)
  console.log(`\n[bench] ${engine.label} (${direction}): ${filtered.length} sentences`)

  const results: SentenceResult[] = []
  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i]!
    const start = performance.now()
    try {
      const output = await withTimeout(
        () => engine.translate(item.source, direction),
        TIMEOUT_PER_TRANSLATION_MS
      )
      const latencyMs = performance.now() - start
      const score = chrF(output, item.reference)
      results.push({
        id: item.id,
        direction,
        domain: item.domain,
        source: item.source,
        reference: item.reference,
        output,
        latencyMs,
        chrF: score
      })
      console.log(
        `  [${i + 1}/${filtered.length}] ${item.id}  ${latencyMs.toFixed(0)}ms  chrF=${score.toFixed(1)}`
      )
    } catch (err) {
      const latencyMs = performance.now() - start
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  [${i + 1}/${filtered.length}] ${item.id} ERROR: ${message}`)
      results.push({
        id: item.id,
        direction,
        domain: item.domain,
        source: item.source,
        reference: item.reference,
        output: '',
        latencyMs,
        chrF: 0,
        error: message
      })
    }
  }

  const successful = results.filter((r) => !r.error)
  const latencies = successful.map((r) => r.latencyMs).sort((a, b) => a - b)
  const chrFs = successful.map((r) => r.chrF)
  const meanChrF = chrFs.length === 0 ? 0 : chrFs.reduce((a, b) => a + b, 0) / chrFs.length

  return {
    engineId: engine.id,
    engineLabel: engine.label,
    direction,
    sampleCount: filtered.length,
    errors: results.filter((r) => r.error).length,
    meanChrF,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      min: latencies[0] ?? 0,
      max: latencies[latencies.length - 1] ?? 0
    },
    results
  }
}

// ── Reporting ──

interface BenchmarkReport {
  timestamp: string
  metricNotes: string
  datasetSize: number
  summaries: EngineSummary[]
}

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals)
}

function buildSummaryTable(summaries: EngineSummary[]): string {
  const header =
    '| Engine | Direction | Samples | Errors | Mean chrF | p50 (ms) | p95 (ms) | p99 (ms) |'
  const sep = '|---|---|---|---|---|---|---|---|'
  const rows = summaries.map(
    (s) =>
      `| ${s.engineLabel} | ${s.direction.toUpperCase()} | ${s.sampleCount} | ${s.errors} | ${fmt(s.meanChrF, 1)} | ${fmt(s.latency.p50)} | ${fmt(s.latency.p95)} | ${fmt(s.latency.p99)} |`
  )
  return [header, sep, ...rows].join('\n')
}

function buildMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [
    '# Conversational JA<->EN Translation Benchmark',
    '',
    `Run: ${report.timestamp}`,
    `Dataset size: ${report.datasetSize} utterances`,
    '',
    '## Metric Notes',
    '',
    report.metricNotes,
    '',
    '## Summary',
    '',
    buildSummaryTable(report.summaries),
    ''
  ]
  return lines.join('\n')
}

function buildHumanEvalCsv(report: BenchmarkReport): string {
  // Pick first SUBJECTIVE_SAMPLE_SIZE utterance IDs (deterministic order)
  const idsSeen = new Set<string>()
  const sampleIds: string[] = []
  for (const s of report.summaries) {
    for (const r of s.results) {
      if (!idsSeen.has(r.id)) {
        idsSeen.add(r.id)
        sampleIds.push(r.id)
      }
      if (sampleIds.length >= SUBJECTIVE_SAMPLE_SIZE) break
    }
    if (sampleIds.length >= SUBJECTIVE_SAMPLE_SIZE) break
  }

  const engineIds = [...new Set(report.summaries.map((s) => s.engineId))]
  const outputHeaders = engineIds.map((id) => `${id}_output`)
  const scoreHeaders = engineIds.map((id) => `${id}_score_1to5`)
  const header = ['id', 'direction', 'source', 'reference', ...outputHeaders, ...scoreHeaders].join(
    ','
  )

  const rows = sampleIds.map((id) => {
    let direction: Direction | '' = ''
    let source = ''
    let reference = ''
    const outputs: string[] = []
    for (const engineId of engineIds) {
      const summary = report.summaries.find(
        (s) => s.engineId === engineId && s.results.some((r) => r.id === id)
      )
      const result = summary?.results.find((r) => r.id === id)
      if (result) {
        direction = result.direction
        source = result.source
        reference = result.reference
        outputs.push(csvField(result.output))
      } else {
        outputs.push('')
      }
    }
    const scores = engineIds.map(() => '')
    return [
      id,
      direction,
      csvField(source),
      csvField(reference),
      ...outputs,
      ...scores
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

function csvField(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

function writeReports(report: BenchmarkReport): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const ts = report.timestamp.replace(/[:.]/g, '-').slice(0, 19)
  const base = `conversational-ja-en-${ts}`

  const jsonPath = join(RESULTS_DIR, `${base}.json`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  console.log(`[bench] JSON: ${jsonPath}`)

  const mdPath = join(RESULTS_DIR, `${base}.md`)
  writeFileSync(mdPath, buildMarkdown(report))
  console.log(`[bench] Markdown: ${mdPath}`)

  const csvPath = join(RESULTS_DIR, `conversational-human-eval-${ts}.csv`)
  writeFileSync(csvPath, buildHumanEvalCsv(report))
  console.log(`[bench] Human-eval CSV: ${csvPath}`)
}

// ── CLI ──

interface ParsedArgs {
  engines: EngineId[]
  directions: Direction[]
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  let engines: EngineId[] = [...AVAILABLE_ENGINES]
  let directions: Direction[] = ['ja-en', 'en-ja']

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--engines' && args[i + 1]) {
      const requested = args[i + 1]!.split(',').map((e) => e.trim()) as EngineId[]
      for (const id of requested) {
        if (!AVAILABLE_ENGINES.includes(id)) {
          console.error(`[bench] Unknown engine "${id}". Available: ${AVAILABLE_ENGINES.join(', ')}`)
          process.exit(1)
        }
      }
      engines = requested
      i++
    } else if (arg === '--direction' && args[i + 1]) {
      const dir = args[i + 1] as Direction
      if (dir !== 'ja-en' && dir !== 'en-ja') {
        console.error(`[bench] --direction must be ja-en or en-ja, got "${dir}"`)
        process.exit(1)
      }
      directions = [dir]
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx --expose-gc bench-translators.ts [options]')
      console.log('')
      console.log(`  --engines <list>   Comma-separated engines (${AVAILABLE_ENGINES.join(', ')})`)
      console.log('  --direction <dir>  ja-en or en-ja (default: both)')
      console.log('  --help             Show this help')
      process.exit(0)
    }
  }

  return { engines, directions }
}

async function main(): Promise<void> {
  const parsed = parseArgs()
  const items = loadDataset()
  console.log(`[bench] Loaded ${items.length} utterances from ${DATA_DIR}`)
  console.log(`[bench] Engines: ${parsed.engines.join(', ')}`)
  console.log(`[bench] Directions: ${parsed.directions.join(', ')}`)

  const summaries: EngineSummary[] = []
  for (const id of parsed.engines) {
    const engine = await createEngine(id)
    if (!engine) continue
    try {
      console.log(`\n[bench] Initializing ${engine.label}...`)
      await engine.initialize()
      for (const direction of parsed.directions) {
        try {
          summaries.push(await evaluateEngine(engine, items, direction))
        } catch (err) {
          console.error(
            `[bench] Fatal error evaluating ${engine.label} (${direction}): ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        }
      }
    } finally {
      try {
        await engine.dispose()
      } catch (err) {
        console.error(
          `[bench] Dispose error for ${engine.label}: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }
  }

  if (summaries.length === 0) {
    console.error('[bench] No engines produced results. Exiting.')
    process.exit(1)
  }

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    metricNotes:
      'Quality is reported as chrF (character n-gram F-score, 0-100). ' +
      'COMET-22 (Unbabel/wmt22-comet-da) is the target metric per issue #706 ' +
      'but requires PyTorch today; chrF is used as a tractable proxy until a ' +
      'Node.js ONNX inference path is available. See metrics.ts for details.',
    datasetSize: items.length,
    summaries
  }
  writeReports(report)
  console.log(`\n[bench] Done.`)
}

main().catch((err) => {
  console.error('[bench] Fatal error:', err)
  process.exit(1)
})
