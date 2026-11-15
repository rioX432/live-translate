/**
 * Pure scoring for run-e2e.ts output: maps VAD segments to ground-truth utterances
 * and derives per-utterance latency, transcript, translation and rewrite counts.
 */
import { computeErrorRate } from '../src/wer'

export interface Utterance {
  id: string
  lang: 'ja' | 'en'
  text: string
  ref: string
  start: number
  end: number
  /** D3/D4 only: expected target-side strings (terms, numbers, negation markers). */
  expect?: string[]
  /** D3 only: source-side term spellings expected in the transcript. */
  expectSrc?: string[]
}

export interface RunEvent {
  t: number
  kind: string
  seg?: number
  src?: string
  tr?: string
  lang?: string
  tgt?: string
}

export interface UttScore {
  id: string
  lang: string
  segs: number[]
  /** Utterance start to the first non-empty source text on screen (s). */
  firstSrcLatency: number | null
  /** Utterance start to the first translation that belongs to this utterance (s). */
  firstTrLatency: number | null
  /** Utterance end to the last final result of its segments (s). */
  finalLatency: number | null
  hypSrc: string
  hypTr: string
  detectedLang: string | null
  targetLang: string | null
  interimUpdates: number
  erasedChars: number
  errorRate: number | null
  refTokens: number
  errors: number
}

/** Seconds after an utterance's speech offset during which its VAD segment may still be open. */
const VAD_TAIL_SEC = 1.2

/**
 * Normalization applied before CER/WER (documented in bench-results.md):
 * NFKC, drop punctuation and symbols except '%', collapse spaces, lowercase.
 * Digits stay digits; spelled-out numbers are not converted.
 */
export function normalizeForErrorRate(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}%\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

interface Segment {
  seg: number
  start: number
  end: number
}

export function segmentsFrom(events: RunEvent[]): Segment[] {
  const segs = new Map<number, Segment>()
  const lastT = new Map<number, number>()
  for (const e of events) {
    if (e.seg === undefined || e.seg < 0) continue
    lastT.set(e.seg, Math.max(lastT.get(e.seg) ?? e.t, e.t))
    if (e.kind === 'vad-start') segs.set(e.seg, { seg: e.seg, start: e.t, end: Number.NaN })
    if ((e.kind === 'vad-end' || e.kind === 'vad-misfire') && segs.has(e.seg)) segs.get(e.seg)!.end = e.t
  }
  // A segment still open when the run ended would otherwise overlap every later utterance.
  for (const s of segs.values()) if (Number.isNaN(s.end)) s.end = lastT.get(s.seg)!
  return [...segs.values()]
}

/** Each segment goes to the utterance it overlaps most; segments overlapping none are false triggers. */
export function assignSegments(segs: Segment[], utts: Utterance[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const s of segs) {
    let best = ''
    let bestOv = 0
    for (const u of utts) {
      const ov = Math.min(s.end, u.end + VAD_TAIL_SEC) - Math.max(s.start, u.start)
      if (ov > bestOv) {
        bestOv = ov
        best = u.id
      }
    }
    if (best) out.set(s.seg, best)
  }
  return out
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

export function scoreUtterances(events: RunEvent[], utts: Utterance[]): UttScore[] {
  const segs = segmentsFrom(events)
  const owner = assignSegments(segs, utts)
  return utts.map((u) => {
    const mine = new Set([...owner].filter(([, id]) => id === u.id).map(([s]) => s))
    const evs = events.filter((e) => e.seg !== undefined && mine.has(e.seg))
    // A translation already shown before this utterance began is carried over, not new.
    const priorTr = new Set(
      events.filter((e) => e.t < u.start && e.tr).map((e) => e.tr as string)
    )
    let firstSrc: number | null = null
    let firstTr: number | null = null
    let lastFinal: number | null = null
    let updates = 0
    let erased = 0
    let prevSrc = ''
    const finals: RunEvent[] = []
    for (const e of evs) {
      if (e.kind !== 'interim' && e.kind !== 'final') continue
      if (e.src && firstSrc === null) firstSrc = e.t
      if (e.tr && !priorTr.has(e.tr) && firstTr === null) firstTr = e.t
      if (e.kind === 'interim' && e.src && e.src !== prevSrc) {
        if (prevSrc) {
          updates++
          erased += prevSrc.length - commonPrefix(prevSrc, e.src)
        }
        prevSrc = e.src
      }
      if (e.kind === 'final') {
        lastFinal = e.t
        if (e.src) finals.push(e)
        prevSrc = ''
      }
    }
    const joiner = u.lang === 'ja' ? '' : ' '
    const hypSrc = finals.map((e) => e.src).join(joiner)
    const trJoiner = u.lang === 'ja' ? ' ' : ''
    const hypTr = finals.map((e) => e.tr ?? '').join(trJoiner)
    const langs = finals.map((e) => e.lang)
    const detectedLang = langs.length ? mode(langs as string[]) : null
    const targetLang = finals.length ? (finals[0].tgt ?? null) : null
    const er = computeErrorRate(normalizeForErrorRate(u.text), normalizeForErrorRate(hypSrc), u.lang)
    return {
      id: u.id,
      lang: u.lang,
      segs: [...mine].sort((a, b) => a - b),
      firstSrcLatency: firstSrc === null ? null : firstSrc - u.start,
      firstTrLatency: firstTr === null ? null : firstTr - u.start,
      finalLatency: lastFinal === null ? null : lastFinal - u.end,
      hypSrc,
      hypTr,
      detectedLang,
      targetLang,
      interimUpdates: updates,
      erasedChars: erased,
      errorRate: er.totalReferenceTokens ? er.errorRate : null,
      refTokens: er.totalReferenceTokens,
      errors: er.substitutions + er.deletions + er.insertions
    }
  })
}

function mode(xs: string[]): string {
  const c = new Map<string, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0][0]
}

export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const idx = (s.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}
