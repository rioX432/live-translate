/**
 * GPT-Realtime-Whisper streaming STT benchmark (Issue #698).
 *
 * Reads the shared STT manifest under benchmark/testset/stt-manifest.jsonl,
 * submits each clip to the OpenAI Realtime transcription endpoint with
 * `gpt-realtime-whisper` as the model, and reports JA CER + EN WER + latency
 * + projected monthly cost so we can decide whether to design an opt-in cloud
 * STT mode (per the Phase 3 decision gate in #698).
 *
 * The bench is intentionally read-only: it does not modify the manifest or
 * any production engine code. To run it you need:
 *   - OPENAI_API_KEY in env
 *   - The 16 kHz mono WAV fixtures under benchmark/testset/stt-audio/ (use
 *     `npm run stt:generate-testset` from benchmark/ to (re)create them)
 *
 * Usage:
 *   cd benchmark
 *   OPENAI_API_KEY=sk-... npx tsx --expose-gc \
 *     gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts
 *
 *   # JA only
 *   OPENAI_API_KEY=sk-... npx tsx --expose-gc \
 *     gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts --language ja
 *
 *   # Try a different latency tier
 *   OPENAI_API_KEY=sk-... npx tsx --expose-gc \
 *     gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts --latency medium
 *
 * Output: a timestamped JSON + Markdown report under
 *   gpt-realtime-whisper-eval/results/
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AccuracyStats, STTLanguage, STTTestEntry } from '../src/stt-types.js'
import { computeErrorRate, aggregateAccuracy } from '../src/wer.js'
import { percentile } from '../conversational-ja-en/metrics.js'

import { float32ToPcm16, readWav, resampleLinear } from './audio.js'
import { formatUsd, projectMonthlyUsd } from './cost.js'
import { transcribeOnce, type LatencyTier } from './realtime-client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, '..', 'testset', 'stt-manifest.jsonl')
const TESTSET_DIR = join(__dirname, '..', 'testset')
const RESULTS_DIR = join(__dirname, 'results')

const TARGET_SAMPLE_RATE = 24_000
const DEFAULT_TIMEOUT_MS = 60_000
const PROJECTION_HOURS_PER_DAY = 4 // matches the #698 issue body
const PROJECTION_DAYS_PER_MONTH = 22

interface PerSentenceResult {
  id: string
  language: STTLanguage
  domain: string
  reference: string
  hypothesis: string
  audioDurationSec: number
  ttfdMs?: number
  totalMs: number
  errorRate: number
  error?: string
}

interface LanguageSummary {
  language: STTLanguage
  sampleCount: number
  errors: number
  accuracy: AccuracyStats
  ttfd: { p50: number; p95: number; p99: number }
  total: { p50: number; p95: number; p99: number }
  audioDurationSec: number
}

interface Report {
  timestamp: string
  model: 'gpt-realtime-whisper'
  latency: LatencyTier
  endpoint: string
  manifest: string
  perLanguage: LanguageSummary[]
  results: PerSentenceResult[]
  cost: {
    usdPerMinute: number
    projectionHoursPerDay: number
    projectionDaysPerMonth: number
    projectedMonthlyUsd: number
  }
  notes: string
}

// ── Dataset loading ──

function loadManifest(): STTTestEntry[] {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing STT manifest at ${MANIFEST_PATH}`)
  }
  return readFileSync(MANIFEST_PATH, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as STTTestEntry)
}

function resolveAudioPath(entry: STTTestEntry): string {
  return resolve(join(TESTSET_DIR, entry.audio_path))
}

// ── CLI parsing ──

interface ParsedArgs {
  language: STTLanguage | 'all'
  latency: LatencyTier
  endpoint?: string
  timeoutMs: number
  limit?: number
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  const parsed: ParsedArgs = {
    language: 'all',
    latency: 'low',
    timeoutMs: DEFAULT_TIMEOUT_MS
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--language' && args[i + 1]) {
      const value = args[i + 1] as STTLanguage | 'all'
      if (value !== 'ja' && value !== 'en' && value !== 'all') {
        console.error(`[bench] --language must be ja, en, or all. Got "${value}".`)
        process.exit(1)
      }
      parsed.language = value
      i++
    } else if (arg === '--latency' && args[i + 1]) {
      const value = args[i + 1] as LatencyTier
      const allowed: LatencyTier[] = ['minimal', 'low', 'medium', 'high', 'xhigh']
      if (!allowed.includes(value)) {
        console.error(`[bench] --latency must be one of ${allowed.join(', ')}. Got "${value}".`)
        process.exit(1)
      }
      parsed.latency = value
      i++
    } else if (arg === '--endpoint' && args[i + 1]) {
      parsed.endpoint = args[i + 1]
      i++
    } else if (arg === '--timeout' && args[i + 1]) {
      parsed.timeoutMs = Number.parseInt(args[i + 1]!, 10)
      if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
        console.error(`[bench] --timeout must be a positive integer (ms).`)
        process.exit(1)
      }
      i++
    } else if (arg === '--limit' && args[i + 1]) {
      parsed.limit = Number.parseInt(args[i + 1]!, 10)
      if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
        console.error(`[bench] --limit must be a positive integer.`)
        process.exit(1)
      }
      i++
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return parsed
}

function printHelp(): void {
  console.log(
    [
      'Usage: tsx gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts [options]',
      '',
      '  --language ja|en|all   Subset of the manifest to evaluate (default: all)',
      '  --latency <tier>       minimal|low|medium|high|xhigh (default: low)',
      '  --limit <n>            Only evaluate the first n clips (debug helper)',
      '  --timeout <ms>         Per-clip timeout in ms (default: 60000)',
      '  --endpoint <url>       Override the Realtime WebSocket URL',
      '  --help                 Show this message',
      '',
      'Requires OPENAI_API_KEY in env. Skips cleanly if not set so CI never',
      'flakes on missing secrets.'
    ].join('\n')
  )
}

// ── Reporting helpers ──

function summarizeLanguage(
  language: STTLanguage,
  results: PerSentenceResult[]
): LanguageSummary {
  const filtered = results.filter((r) => r.language === language)
  const successful = filtered.filter((r) => !r.error)
  const ttfd = successful
    .map((r) => r.ttfdMs ?? r.totalMs)
    .sort((a, b) => a - b)
  const total = successful.map((r) => r.totalMs).sort((a, b) => a - b)
  const accuracy = aggregateAccuracy(
    successful.map((r) =>
      computeErrorRate(r.reference, r.hypothesis, r.language)
    )
  )
  return {
    language,
    sampleCount: filtered.length,
    errors: filtered.length - successful.length,
    accuracy,
    ttfd: {
      p50: percentile(ttfd, 50),
      p95: percentile(ttfd, 95),
      p99: percentile(ttfd, 99)
    },
    total: {
      p50: percentile(total, 50),
      p95: percentile(total, 95),
      p99: percentile(total, 99)
    },
    audioDurationSec: successful.reduce((acc, r) => acc + r.audioDurationSec, 0)
  }
}

function buildMarkdown(report: Report): string {
  const lines: string[] = [
    '# GPT-Realtime-Whisper Benchmark',
    '',
    `Run: ${report.timestamp}`,
    `Model: ${report.model}`,
    `Latency tier: ${report.latency}`,
    `Endpoint: ${report.endpoint}`,
    `Manifest: ${report.manifest}`,
    '',
    '## Accuracy & Latency',
    '',
    '| Language | Samples | Errors | Error rate (CER/WER) | TTFD p50 | TTFD p95 | Total p50 | Total p95 |',
    '|---|---|---|---|---|---|---|---|'
  ]
  for (const s of report.perLanguage) {
    const errPct = (s.accuracy.errorRate * 100).toFixed(2)
    lines.push(
      `| ${s.language.toUpperCase()} | ${s.sampleCount} | ${s.errors} | ${errPct}% | ${s.ttfd.p50.toFixed(0)}ms | ${s.ttfd.p95.toFixed(0)}ms | ${s.total.p50.toFixed(0)}ms | ${s.total.p95.toFixed(0)}ms |`
    )
  }
  lines.push('')
  lines.push('## Projected Cost')
  lines.push('')
  lines.push(
    `Price: ${formatUsd(report.cost.usdPerMinute, 3)} per minute (documented 2026-05-07).`
  )
  lines.push(
    `Projection @ ${report.cost.projectionHoursPerDay}h/day x ${report.cost.projectionDaysPerMonth} days/month: ${formatUsd(report.cost.projectedMonthlyUsd)}/month per user.`
  )
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push(report.notes)
  return lines.join('\n') + '\n'
}

function writeReport(report: Report): { jsonPath: string; mdPath: string } {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const ts = report.timestamp.replace(/[:.]/g, '-').slice(0, 19)
  const base = `gpt-realtime-whisper-${report.latency}-${ts}`
  const jsonPath = join(RESULTS_DIR, `${base}.json`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  const mdPath = join(RESULTS_DIR, `${base}.md`)
  writeFileSync(mdPath, buildMarkdown(report))
  return { jsonPath, mdPath }
}

// ── Main ──

async function main(): Promise<void> {
  const parsed = parseArgs()
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn(
      '[bench] OPENAI_API_KEY is not set. Skipping the gpt-realtime-whisper benchmark.\n' +
        '        Re-run with the env var set to produce a real result.'
    )
    return
  }

  const manifest = loadManifest()
  let entries =
    parsed.language === 'all'
      ? manifest
      : manifest.filter((e) => e.language === parsed.language)
  if (parsed.limit !== undefined) {
    entries = entries.slice(0, parsed.limit)
  }
  if (entries.length === 0) {
    console.error(`[bench] No manifest entries matched filter "${parsed.language}".`)
    process.exit(1)
  }

  console.log(
    `[bench] gpt-realtime-whisper @ ${parsed.latency} latency, ${entries.length} clips`
  )
  const results: PerSentenceResult[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const audioPath = resolveAudioPath(entry)
    if (!existsSync(audioPath)) {
      console.error(
        `  [${i + 1}/${entries.length}] ${entry.id}: missing audio file at ${audioPath}.\n` +
          '        Run `npm run stt:generate-testset` from benchmark/ to (re)create it.'
      )
      results.push({
        id: entry.id,
        language: entry.language,
        domain: entry.domain,
        reference: entry.reference_text,
        hypothesis: '',
        audioDurationSec: 0,
        totalMs: 0,
        errorRate: 1,
        error: `missing audio file: ${audioPath}`
      })
      continue
    }

    try {
      const wav = readWav(audioPath)
      const upsampled = resampleLinear(wav.samples, wav.sampleRate, TARGET_SAMPLE_RATE)
      const pcm = float32ToPcm16(upsampled)
      const result = await transcribeOnce({
        apiKey,
        languageHint: entry.language,
        latency: parsed.latency,
        pcm16At24kHz: pcm,
        timeoutMs: parsed.timeoutMs,
        endpoint: parsed.endpoint
      })
      const accuracy = computeErrorRate(entry.reference_text, result.text, entry.language)
      results.push({
        id: entry.id,
        language: entry.language,
        domain: entry.domain,
        reference: entry.reference_text,
        hypothesis: result.text,
        audioDurationSec: wav.samples.length / wav.sampleRate,
        ttfdMs: result.ttfdMs,
        totalMs: result.totalMs,
        errorRate: accuracy.errorRate
      })
      const errPct = (accuracy.errorRate * 100).toFixed(1)
      const ttfd = result.ttfdMs ? `${result.ttfdMs.toFixed(0)}ms` : 'n/a'
      console.log(
        `  [${i + 1}/${entries.length}] ${entry.id}: ER=${errPct}% TTFD=${ttfd} total=${result.totalMs.toFixed(0)}ms`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  [${i + 1}/${entries.length}] ${entry.id}: ERROR ${message}`)
      results.push({
        id: entry.id,
        language: entry.language,
        domain: entry.domain,
        reference: entry.reference_text,
        hypothesis: '',
        audioDurationSec: 0,
        totalMs: 0,
        errorRate: 1,
        error: message
      })
    }
  }

  const languages: STTLanguage[] =
    parsed.language === 'all' ? ['ja', 'en'] : [parsed.language]
  const perLanguage = languages.map((lang) => summarizeLanguage(lang, results))

  const report: Report = {
    timestamp: new Date().toISOString(),
    model: 'gpt-realtime-whisper',
    latency: parsed.latency,
    endpoint: parsed.endpoint ?? 'wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper',
    manifest: MANIFEST_PATH,
    perLanguage,
    results,
    cost: {
      usdPerMinute: 0.017,
      projectionHoursPerDay: PROJECTION_HOURS_PER_DAY,
      projectionDaysPerMonth: PROJECTION_DAYS_PER_MONTH,
      projectedMonthlyUsd: projectMonthlyUsd(PROJECTION_HOURS_PER_DAY, PROJECTION_DAYS_PER_MONTH)
    },
    notes:
      'Audio: 16 kHz mono WAV from benchmark/testset/stt-audio, linearly upsampled to 24 kHz PCM16 ' +
      'because the Realtime endpoint requires 24 kHz input. CER/WER are computed against the manifest references ' +
      'with the same tokenization rules used by every other engine in benchmark/src/wer.ts so the numbers are ' +
      'directly comparable to existing local-engine baselines.'
  }
  const { jsonPath, mdPath } = writeReport(report)
  console.log(`\n[bench] JSON: ${jsonPath}`)
  console.log(`[bench] Markdown: ${mdPath}`)
  for (const summary of perLanguage) {
    const errPct = (summary.accuracy.errorRate * 100).toFixed(2)
    console.log(
      `[bench] ${summary.language.toUpperCase()}: ${errPct}% (n=${summary.sampleCount}, errors=${summary.errors}) ` +
        `TTFD p50=${summary.ttfd.p50.toFixed(0)}ms total p50=${summary.total.p50.toFixed(0)}ms`
    )
  }
  console.log(
    `[bench] Projected cost @ ${PROJECTION_HOURS_PER_DAY}h/day x ${PROJECTION_DAYS_PER_MONTH}d/month: ${formatUsd(report.cost.projectedMonthlyUsd)}`
  )
}

main().catch((err) => {
  console.error('[bench] Fatal:', err)
  process.exit(1)
})
