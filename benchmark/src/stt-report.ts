import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkResult, STTEngineSummary, WERResult } from './stt-types.js'
import { computeWER, aggregateWER } from './wer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, '..', 'results')

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals)
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function buildSummaryTable(summaries: STTEngineSummary[]): string {
  const header =
    '| Engine | Avg Latency | Median | P95 | WER | Peak RSS | Errors |'
  const sep = '|---|---|---|---|---|---|---|'
  const rows = summaries.map((s) => {
    return (
      `| ${s.engineLabel} | ${fmt(s.latency.avg)}ms | ${fmt(s.latency.median)}ms` +
      ` | ${fmt(s.latency.p95)}ms | ${fmtPct(s.wer.wer)} | ${fmt(s.peakRssMB / 1024, 2)}GB | ${s.errors} |`
    )
  })
  return [header, sep, ...rows].join('\n')
}

function buildLanguageBreakdownTable(summaries: STTEngineSummary[]): string {
  // Collect all languages
  const languages = new Set<string>()
  for (const s of summaries) {
    for (const lang of Object.keys(s.werByLanguage)) {
      languages.add(lang)
    }
  }

  const langList = [...languages].sort()
  const werHeaders = langList.map((l) => `WER (${l.toUpperCase()})`)
  const latHeaders = langList.map((l) => `Latency (${l.toUpperCase()})`)

  const header = `| Engine | ${werHeaders.join(' | ')} | ${latHeaders.join(' | ')} |`
  const sep = `|---|${langList.map(() => '---').join('|')}|${langList.map(() => '---').join('|')}|`

  const rows = summaries.map((s) => {
    const werCells = langList.map((lang) => {
      const w = s.werByLanguage[lang]
      return w ? fmtPct(w.wer) : 'N/A'
    })
    const latCells = langList.map((lang) => {
      const langResults = s.results.filter((r) => r.language === lang && !r.error)
      if (langResults.length === 0) return 'N/A'
      const avg = langResults.reduce((acc, r) => acc + r.latencyMs, 0) / langResults.length
      return `${fmt(avg)}ms`
    })
    return `| ${s.engineLabel} | ${werCells.join(' | ')} | ${latCells.join(' | ')} |`
  })

  return [header, sep, ...rows].join('\n')
}

function buildDomainBreakdownTable(summaries: STTEngineSummary[]): string {
  const domains = new Set<string>()
  for (const s of summaries) {
    for (const r of s.results) {
      domains.add(r.domain)
    }
  }

  const domainList = [...domains].sort()
  const header = `| Engine | ${domainList.map((d) => `WER (${d})`).join(' | ')} | ${domainList.map((d) => `Latency (${d})`).join(' | ')} |`
  const sep = `|---|${domainList.map(() => '---').join('|')}|${domainList.map(() => '---').join('|')}|`

  const rows = summaries.map((s) => {
    const werCells = domainList.map((domain) => {
      const domainResults = s.results.filter((r) => r.domain === domain && !r.error)
      if (domainResults.length === 0) return 'N/A'
      const wers = domainResults.map((r) => computeWER(r.reference, r.output, r.language))
      const agg = aggregateWER(wers)
      return fmtPct(agg.wer)
    })
    const latCells = domainList.map((domain) => {
      const domainResults = s.results.filter((r) => r.domain === domain && !r.error)
      if (domainResults.length === 0) return 'N/A'
      const avg = domainResults.reduce((acc, r) => acc + r.latencyMs, 0) / domainResults.length
      return `${fmt(avg)}ms`
    })
    return `| ${s.engineLabel} | ${werCells.join(' | ')} | ${latCells.join(' | ')} |`
  })

  return [header, sep, ...rows].join('\n')
}

function buildGoNoGoTable(summaries: STTEngineSummary[]): string {
  const LATENCY_THRESHOLD_MS = 3000 // 3s for STT (audio files may be several seconds long)
  const WER_THRESHOLD = 0.30 // 30% WER
  const MEMORY_THRESHOLD_MB = 4 * 1024 // 4GB

  const header = `| Criteria | ${summaries.map((s) => s.engineLabel).join(' | ')} |`
  const sep = `|---|${summaries.map(() => '---').join('|')}|`

  const latencyRow = `| Latency acceptable (<3s) | ${summaries
    .map((s) => (s.latency.avg < LATENCY_THRESHOLD_MS ? `Yes (${fmt(s.latency.avg)}ms)` : `No (${fmt(s.latency.avg)}ms)`))
    .join(' | ')} |`

  const werRow = `| WER acceptable (<30%) | ${summaries
    .map((s) => (s.wer.wer < WER_THRESHOLD ? `Yes (${fmtPct(s.wer.wer)})` : `No (${fmtPct(s.wer.wer)})`))
    .join(' | ')} |`

  const memoryRow = `| Memory acceptable (<4GB) | ${summaries
    .map((s) => (s.peakRssMB < MEMORY_THRESHOLD_MB ? `Yes (${fmt(s.peakRssMB / 1024, 2)}GB)` : `No (${fmt(s.peakRssMB / 1024, 2)}GB)`))
    .join(' | ')} |`

  const recRow = `| Recommendation | ${summaries
    .map((s) => {
      const ok = s.latency.avg < LATENCY_THRESHOLD_MS && s.wer.wer < WER_THRESHOLD && s.peakRssMB < MEMORY_THRESHOLD_MB
      return ok ? 'Go' : 'No-Go'
    })
    .join(' | ')} |`

  return [header, sep, latencyRow, werRow, memoryRow, recRow].join('\n')
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
    '## WER & Latency by Language',
    '',
    buildLanguageBreakdownTable(result.summaries),
    '',
    '## WER & Latency by Domain',
    '',
    buildDomainBreakdownTable(result.summaries),
    '',
    '## Go/No-Go Recommendation',
    '',
    buildGoNoGoTable(result.summaries),
    ''
  ]
  return lines.join('\n')
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

  // Per-engine detailed results CSV
  const csvPath = join(RESULTS_DIR, `stt-results-${ts}.csv`)
  const csvHeader = 'engine,id,language,domain,reference,output,latency_ms,error'
  const csvRows = result.summaries.flatMap((s) =>
    s.results.map(
      (r) =>
        `${s.engineId},${r.id},${r.language},${r.domain},"${esc(r.reference)}","${esc(r.output)}",${r.latencyMs.toFixed(0)},${r.error ? `"${esc(r.error)}"` : ''}`
    )
  )
  writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'))
  console.log(`[stt-report] CSV: ${csvPath}`)

  return RESULTS_DIR
}

function esc(s: string): string {
  return s.replace(/"/g, '""')
}
