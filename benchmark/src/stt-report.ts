import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkResult, STTEngineSummary } from './stt-types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, '..', 'results')

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals)
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function buildSummaryTable(summaries: STTEngineSummary[]): string {
  const header =
    '| Engine | Language | Files | Error Rate | Avg Latency | Median | P95 | Peak RSS | Errors |'
  const sep = '|---|---|---|---|---|---|---|---|---|'
  const rows = summaries.map((s) => {
    const metricLabel = s.language === 'ja' ? 'CER' : s.language === 'en' ? 'WER' : 'ER'
    return (
      `| ${s.engineLabel} | ${s.language.toUpperCase()} | ${s.totalFiles} ` +
      `| ${pct(s.accuracy.errorRate)} (${metricLabel}) ` +
      `| ${fmt(s.latency.avg)}ms | ${fmt(s.latency.median)}ms | ${fmt(s.latency.p95)}ms ` +
      `| ${fmt(s.peakRssMB / 1024, 2)}GB | ${s.errors} |`
    )
  })
  return [header, sep, ...rows].join('\n')
}

function buildDomainBreakdown(summaries: STTEngineSummary[]): string {
  const domains = ['casual', 'business', 'technical']
  const header = `| Engine | Language | ${domains.join(' | ')} |`
  const sep = `|---|---|${domains.map(() => '---').join('|')}|`
  const rows = summaries.map((s) => {
    const cells = domains.map((d) => {
      const matched = s.results.filter((r) => r.domain === d && !r.error)
      if (matched.length === 0) return 'N/A'
      const avg = matched.reduce((acc, r) => acc + r.latencyMs, 0) / matched.length
      return `${fmt(avg)}ms`
    })
    return `| ${s.engineLabel} | ${s.language.toUpperCase()} | ${cells.join(' | ')} |`
  })
  return [header, sep, ...rows].join('\n')
}

function buildAccuracyBreakdown(summaries: STTEngineSummary[]): string {
  const header =
    '| Engine | Language | Substitutions | Deletions | Insertions | Ref Tokens | Error Rate |'
  const sep = '|---|---|---|---|---|---|---|'
  const rows = summaries.map((s) => {
    const a = s.accuracy
    return (
      `| ${s.engineLabel} | ${s.language.toUpperCase()} ` +
      `| ${a.substitutions} | ${a.deletions} | ${a.insertions} ` +
      `| ${a.totalReferenceTokens} | ${pct(a.errorRate)} |`
    )
  })
  return [header, sep, ...rows].join('\n')
}

function buildGoNoGoTable(summaries: STTEngineSummary[]): string {
  const LATENCY_THRESHOLD = 3000 // 3s for STT (longer than translation)
  const ERROR_RATE_THRESHOLD = 0.25 // 25% WER/CER
  const MEMORY_THRESHOLD_MB = 4 * 1024

  // Aggregate per-engine across languages
  const engineIds = [...new Set(summaries.map((s) => s.engineId))]
  const engineMetrics = engineIds.map((id) => {
    const runs = summaries.filter((s) => s.engineId === id)
    const label = runs[0]?.engineLabel ?? id

    // Use "all" language if available, otherwise average across languages
    const allRun = runs.find((r) => r.language === 'all')
    const avgLatency = allRun
      ? allRun.latency.avg
      : runs.reduce((acc, r) => acc + r.latency.avg, 0) / runs.length
    const avgErrorRate = allRun
      ? allRun.accuracy.errorRate
      : runs.reduce((acc, r) => acc + r.accuracy.errorRate, 0) / runs.length
    const peakRss = Math.max(...runs.map((r) => r.peakRssMB))

    const latencyOk = avgLatency < LATENCY_THRESHOLD
    const accuracyOk = avgErrorRate < ERROR_RATE_THRESHOLD
    const memoryOk = peakRss < MEMORY_THRESHOLD_MB

    return { id, label, avgLatency, avgErrorRate, peakRss, latencyOk, accuracyOk, memoryOk }
  })

  const header = `| Criteria | ${engineMetrics.map((e) => e.label).join(' | ')} |`
  const sep = `|---|${engineMetrics.map(() => '---').join('|')}|`

  const latencyRow = `| Latency (<3s) | ${engineMetrics.map((e) => (e.latencyOk ? `Yes (${fmt(e.avgLatency)}ms)` : `No (${fmt(e.avgLatency)}ms)`)).join(' | ')} |`
  const accuracyRow = `| Error rate (<25%) | ${engineMetrics.map((e) => (e.accuracyOk ? `Yes (${pct(e.avgErrorRate)})` : `No (${pct(e.avgErrorRate)})`)).join(' | ')} |`
  const memoryRow = `| Memory (<4GB) | ${engineMetrics.map((e) => (e.memoryOk ? `Yes (${fmt(e.peakRss / 1024, 2)}GB)` : `No (${fmt(e.peakRss / 1024, 2)}GB)`)).join(' | ')} |`
  const recRow = `| Recommendation | ${engineMetrics.map((e) => (e.latencyOk && e.accuracyOk && e.memoryOk ? 'Go' : 'No-Go')).join(' | ')} |`

  return [header, sep, latencyRow, accuracyRow, memoryRow, recRow].join('\n')
}

function buildMarkdown(result: STTBenchmarkResult): string {
  const lines: string[] = [
    '# STT Benchmark Results',
    '',
    `Run: ${result.timestamp}`,
    '',
    '## Summary',
    '',
    buildSummaryTable(result.summaries),
    '',
    '## Accuracy Breakdown',
    '',
    buildAccuracyBreakdown(result.summaries),
    '',
    '## Latency by Domain',
    '',
    buildDomainBreakdown(result.summaries),
    '',
    '## Go/No-Go Recommendation',
    '',
    buildGoNoGoTable(result.summaries),
    ''
  ]
  return lines.join('\n')
}

function buildDetailCSV(result: STTBenchmarkResult): string {
  const engineIds = [...new Set(result.summaries.map((s) => s.engineId))]

  // Collect all entry IDs
  const allIds = new Set<string>()
  for (const s of result.summaries) {
    for (const r of s.results) {
      allIds.add(r.id)
    }
  }

  // Build output map: id -> engineId -> hypothesis
  const outputMap = new Map<string, Map<string, string>>()
  const refMap = new Map<string, { reference: string; language: string; domain: string }>()
  for (const s of result.summaries) {
    for (const r of s.results) {
      if (!outputMap.has(r.id)) outputMap.set(r.id, new Map())
      outputMap.get(r.id)!.set(s.engineId, r.hypothesis)
      if (!refMap.has(r.id)) {
        refMap.set(r.id, {
          reference: r.reference,
          language: r.language,
          domain: r.domain
        })
      }
    }
  }

  const hypHeaders = engineIds.map((id) => `${id}_hypothesis`)
  const header = ['id', 'language', 'domain', 'reference', ...hypHeaders].join(',')

  const rows = [...allIds].map((id) => {
    const ref = refMap.get(id)!
    const hypotheses = engineIds.map((eid) => {
      const text = outputMap.get(id)?.get(eid) ?? ''
      return `"${text.replace(/"/g, '""')}"`
    })
    return [
      id,
      ref.language,
      ref.domain,
      `"${ref.reference.replace(/"/g, '""')}"`,
      ...hypotheses
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

/** Write all STT report files to results/ directory */
export function writeSTTReports(result: STTBenchmarkResult): string {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const ts = result.timestamp.replace(/[:.]/g, '-').slice(0, 19)

  // Raw JSON
  const jsonPath = join(RESULTS_DIR, `stt-benchmark-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(result, null, 2))
  console.log(`[stt-report] JSON: ${jsonPath}`)

  // Markdown summary
  const mdPath = join(RESULTS_DIR, `stt-benchmark-${ts}.md`)
  writeFileSync(mdPath, buildMarkdown(result))
  console.log(`[stt-report] Markdown: ${mdPath}`)

  // Detail CSV
  const csvPath = join(RESULTS_DIR, `stt-detail-${ts}.csv`)
  writeFileSync(csvPath, buildDetailCSV(result))
  console.log(`[stt-report] Detail CSV: ${csvPath}`)

  return RESULTS_DIR
}
