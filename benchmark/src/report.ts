import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { BenchmarkResult, EngineSummary } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, '..', 'results')

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals)
}

function buildSummaryTable(summaries: EngineSummary[]): string {
  const header =
    '| Engine | Direction | Avg Latency | Median | P95 Latency | Peak RSS | Errors |'
  const sep = '|---|---|---|---|---|---|---|'
  const rows = summaries.map((s) => {
    return `| ${s.engineLabel} | ${s.direction.toUpperCase()} | ${fmt(s.latency.avg)}ms | ${fmt(s.latency.median)}ms | ${fmt(s.latency.p95)}ms | ${fmt(s.peakRssMB / 1024, 2)}GB | ${s.errors} |`
  })
  return [header, sep, ...rows].join('\n')
}

function buildBreakdownTable(
  summaries: EngineSummary[],
  groupBy: 'domain' | 'length'
): string {
  const groups = new Set<string>()
  for (const s of summaries) {
    for (const r of s.results) {
      groups.add(r[groupBy])
    }
  }

  const header = `| Engine | Direction | ${[...groups].join(' | ')} |`
  const sep = `|---|---|${[...groups].map(() => '---').join('|')}|`
  const rows = summaries.map((s) => {
    const cells = [...groups].map((g) => {
      const matched = s.results.filter((r) => r[groupBy] === g && !r.error)
      if (matched.length === 0) return 'N/A'
      const avg = matched.reduce((acc, r) => acc + r.latencyMs, 0) / matched.length
      return `${fmt(avg)}ms`
    })
    return `| ${s.engineLabel} | ${s.direction.toUpperCase()} | ${cells.join(' | ')} |`
  })
  return [header, sep, ...rows].join('\n')
}

function buildGoNoGoTable(summaries: EngineSummary[]): string {
  const LATENCY_THRESHOLD = 500
  const MEMORY_THRESHOLD_MB = 4 * 1024

  // Collect unique engine IDs preserving order
  const engineIds = [...new Set(summaries.map((s) => s.engineId))]

  // Aggregate per-engine metrics across directions
  const engineMetrics = engineIds.map((id) => {
    const runs = summaries.filter((s) => s.engineId === id)
    const label = runs[0]?.engineLabel ?? id
    const avgLatency =
      runs.reduce((acc, r) => acc + r.latency.avg, 0) / runs.length
    const peakRss = Math.max(...runs.map((r) => r.peakRssMB))
    const latencyOk = avgLatency < LATENCY_THRESHOLD
    const memoryOk = peakRss < MEMORY_THRESHOLD_MB
    const offline = !id.includes('google')
    return { id, label, avgLatency, peakRss, latencyOk, memoryOk, offline }
  })

  const header = `| Criteria | ${engineMetrics.map((e) => e.label).join(' | ')} |`
  const sep = `|---|${engineMetrics.map(() => '---').join('|')}|`

  const latencyRow = `| Latency acceptable (<500ms) | ${engineMetrics.map((e) => (e.latencyOk ? `Yes (${fmt(e.avgLatency)}ms)` : `No (${fmt(e.avgLatency)}ms)`)).join(' | ')} |`
  const memoryRow = `| Memory acceptable (<4GB) | ${engineMetrics.map((e) => (e.memoryOk ? `Yes (${fmt(e.peakRss / 1024, 2)}GB)` : `No (${fmt(e.peakRss / 1024, 2)}GB)`)).join(' | ')} |`
  const offlineRow = `| Offline capable | ${engineMetrics.map((e) => (e.offline ? 'Yes' : 'No')).join(' | ')} |`
  const recRow = `| Recommendation | ${engineMetrics.map((e) => (e.latencyOk && e.memoryOk ? 'Go' : 'No-Go')).join(' | ')} |`

  return [header, sep, latencyRow, memoryRow, offlineRow, recRow].join('\n')
}

function buildMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [
    '# Translation Benchmark Results',
    '',
    `Run: ${result.timestamp}`,
    '',
    '## Summary',
    '',
    buildSummaryTable(result.summaries),
    '',
    '## Latency by Domain',
    '',
    buildBreakdownTable(result.summaries, 'domain'),
    '',
    '## Latency by Length',
    '',
    buildBreakdownTable(result.summaries, 'length'),
    '',
    '## Go/No-Go Recommendation',
    '',
    buildGoNoGoTable(result.summaries),
    ''
  ]
  return lines.join('\n')
}

function buildHumanEvalCSV(result: BenchmarkResult): string {
  // Collect all sentence IDs
  const allIds = new Set<string>()
  for (const s of result.summaries) {
    for (const r of s.results) {
      allIds.add(r.id)
    }
  }

  // Build engine output map: id -> engineId -> output
  const outputMap = new Map<string, Map<string, string>>()
  const referenceMap = new Map<string, { source: string; reference: string }>()
  for (const s of result.summaries) {
    for (const r of s.results) {
      if (!outputMap.has(r.id)) outputMap.set(r.id, new Map())
      outputMap.get(r.id)!.set(s.engineId, r.output)
      if (!referenceMap.has(r.id)) {
        referenceMap.set(r.id, { source: r.source, reference: r.reference })
      }
    }
  }

  const engineIds = [...new Set(result.summaries.map((s) => s.engineId))]
  const outputHeaders = engineIds.map((id) => `${id}_output`)
  const scoreHeaders = engineIds.map((id) => `${id}_score`)

  const header = ['id', 'source', 'reference', ...outputHeaders, ...scoreHeaders].join(',')

  const rows = [...allIds].map((id) => {
    const ref = referenceMap.get(id)!
    const outputs = engineIds.map((eid) => {
      const text = outputMap.get(id)?.get(eid) ?? ''
      return `"${text.replace(/"/g, '""')}"`
    })
    const scores = engineIds.map(() => '')
    return [
      id,
      `"${ref.source.replace(/"/g, '""')}"`,
      `"${ref.reference.replace(/"/g, '""')}"`,
      ...outputs,
      ...scores
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

/** Write all report files to results/ directory */
export function writeReports(result: BenchmarkResult): string {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const ts = result.timestamp.replace(/[:.]/g, '-').slice(0, 19)

  // Raw JSON
  const jsonPath = join(RESULTS_DIR, `benchmark-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(result, null, 2))
  console.log(`[report] JSON: ${jsonPath}`)

  // Markdown summary
  const mdPath = join(RESULTS_DIR, `benchmark-${ts}.md`)
  writeFileSync(mdPath, buildMarkdown(result))
  console.log(`[report] Markdown: ${mdPath}`)

  // Human eval CSV
  const csvPath = join(RESULTS_DIR, `human-eval-${ts}.csv`)
  writeFileSync(csvPath, buildHumanEvalCSV(result))
  console.log(`[report] Human eval CSV: ${csvPath}`)

  return RESULTS_DIR
}
