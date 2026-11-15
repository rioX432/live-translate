/**
 * Scores one run-e2e.ts result against its session ground truth.
 *
 *   node benchmark/e2e/dist/score.js --result <run.json> --session <session.json> [--out <dir>]
 *
 * Writes <out>/<tag>__<session>.score.json (summary + per-utterance rows) and
 * <out>/<tag>__<session>.comet.jsonl ({src, mt, ref} per utterance) for COMET / chrF++.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { aggregateAccuracy, computeErrorRate } from '../src/wer'
import { normalizeForErrorRate, normalizeForMatch, percentile, scoreUtterances, type RunEvent, type Utterance } from './score-lib'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const resultPath = arg('result')
const sessionPath = arg('session')
if (!resultPath || !sessionPath) {
  console.error('usage: score --result <run.json> --session <session.json> [--out <dir>]')
  process.exit(2)
}
const outDir = arg('out') ?? join(resultPath, '..')

const run = JSON.parse(readFileSync(resultPath, 'utf8')) as {
  tag: string
  session: string
  audioSec: number
  counters: Record<string, number>
  mem: { peakRssBytes?: number; peakFootprintBytes?: number } & Record<string, unknown>
  loadMs: number
  warmupMs: unknown
  events: RunEvent[]
}
const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as { name: string; utterances: Utterance[] }
// A --maxSec run only heard the utterances that ended inside the fed audio.
const utts = session.utterances.filter((u) => u.end <= run.audioSec)
const rows = scoreUtterances(run.events, utts)

const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null)
const stats = (xs: (number | null)[]) => {
  const v = nums(xs)
  return { n: v.length, missing: xs.length - v.length, p50: percentile(v, 0.5), p90: percentile(v, 0.9) }
}

function perLang(lang: 'ja' | 'en') {
  const rs = rows.filter((r) => r.lang === lang)
  const us = utts.filter((u) => u.lang === lang)
  const acc = aggregateAccuracy(
    us.map((u, i) => computeErrorRate(normalizeForErrorRate(u.text), normalizeForErrorRate(rs[i].hypSrc), lang))
  )
  return {
    utterances: rs.length,
    errorRate: acc.errorRate,
    metric: lang === 'ja' ? 'CER' : 'WER',
    langIdCorrect: rs.filter((r) => r.detectedLang === lang).length,
    langIdWrong: rs.filter((r) => r.detectedLang !== null && r.detectedLang !== lang).length,
    noFinal: rs.filter((r) => r.detectedLang === null).length
  }
}

/**
 * D3/D4: share of expected strings found in the hypothesis (NFKC, case-insensitive substring).
 * An entry 'a|b' is satisfied by any of its variants.
 */
function expectHits(field: 'expect' | 'expectSrc', hypOf: (i: number) => string) {
  let total = 0
  let hit = 0
  const misses: { id: string; expected: string; hyp: string }[] = []
  utts.forEach((u, i) => {
    for (const x of u[field] ?? []) {
      total++
      const hyp = normalizeForMatch(hypOf(i))
      if (x.split('|').some((v) => hyp.includes(normalizeForMatch(v)))) hit++
      else misses.push({ id: u.id, expected: x, hyp: hypOf(i) })
    }
  })
  return total ? { total, hit, rate: hit / total, misses } : null
}

const summary = {
  tag: run.tag,
  session: session.name,
  utterances: utts.length,
  latency: {
    firstSrcFromStart: stats(rows.map((r) => r.firstSrcLatency)),
    firstTrFromStart: stats(rows.map((r) => r.firstTrLatency)),
    finalFromEnd: stats(rows.map((r) => r.finalLatency))
  },
  ja: perLang('ja'),
  en: perLang('en'),
  rewrites: {
    interimUpdatesPerUtt: rows.reduce((a, r) => a + r.interimUpdates, 0) / Math.max(1, rows.length),
    erasedCharsPerUtt: rows.reduce((a, r) => a + r.erasedChars, 0) / Math.max(1, rows.length)
  },
  terms: {
    target: expectHits('expect', (i) => rows[i].hypTr),
    source: expectHits('expectSrc', (i) => rows[i].hypSrc)
  },
  counters: run.counters,
  loadMs: run.loadMs,
  warmupMs: run.warmupMs,
  mem: run.mem
}

mkdirSync(outDir, { recursive: true })
const stem = basename(resultPath).replace(/\.json$/, '')
writeFileSync(join(outDir, `${stem}.score.json`), JSON.stringify({ summary, rows }, null, 2))
writeFileSync(
  join(outDir, `${stem}.comet.jsonl`),
  utts.map((u, i) => JSON.stringify({ id: u.id, lang: u.lang, src: u.text, mt: rows[i].hypTr, ref: u.ref })).join('\n') + '\n'
)

const f = (x: number | null): string => (x === null ? '-' : x.toFixed(2))
const L = summary.latency
console.log(
  `SCORE ${stem} n=${utts.length} firstSrc p50=${f(L.firstSrcFromStart.p50)} firstTr p50=${f(L.firstTrFromStart.p50)}` +
    ` p90=${f(L.firstTrFromStart.p90)} final p50=${f(L.finalFromEnd.p50)} p90=${f(L.finalFromEnd.p90)} miss=${L.finalFromEnd.missing}` +
    ` jaCER=${f(summary.ja.errorRate)} enWER=${f(summary.en.errorRate)}` +
    ` langId ja ${summary.ja.langIdCorrect}/${summary.ja.utterances} en ${summary.en.langIdCorrect}/${summary.en.utterances}`
)
