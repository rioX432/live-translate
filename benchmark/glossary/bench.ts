/**
 * Compares glossary correction at the ASR stage (Qwen3-ASR context, alias
 * replacement) with the translation stage (Hy-MT2 prompt terms), using the
 * product code paths: term-correction.ts and hy-mt2-prompt.ts.
 *
 *   asr   <helper> <model dir> <audio dir> <out dir>   transcripts with and without context
 *   mt    <gguf> <out dir>                             translations for every transcript variant
 *   score <out dir>                                    metrics.json and a Markdown table
 *
 * Inputs are synthetic (data/sentences.json, synth.py); nothing here reads meeting audio.
 */
import { spawn } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import { buildAsrContext, correctTranscript } from '../../src/engines/stt/term-correction'
import { buildHyMt2Prompt, HY_MT2_INFERENCE_PARAMS } from '../../src/engines/translator/hy-mt2-prompt'
import type { GlossaryEntry } from '../../src/engines/types'

interface Utterance {
  id: string
  lang: 'ja' | 'en'
  text: string
  expect: string[]
  expectSrc: string[]
}
interface Data {
  terms: Array<{ ja: string; en: string }>
  glossary: GlossaryEntry[]
  sets: Record<string, Utterance[]>
}
interface AsrRow { id: string; set: string; lang: string; a0: string; a1: string; a0Ms: number; a1Ms: number }
interface MtRow { id: string; variant: string; transcript: string; injected: boolean; t0: string; t1: string; t0Ms: number; t1Ms: number; postUs: number }

// Run from the repository root; the bundle is written outside this directory.
const dataDir = join(process.cwd(), 'benchmark', 'glossary', 'data')
const data: Data = JSON.parse(readFileSync(join(dataDir, 'sentences.json'), 'utf-8'))

function utterances(): Array<Utterance & { set: string }> {
  return Object.entries(data.sets).flatMap(([set, us]) => us.map((u) => ({ ...u, set })))
}

/** Glossary with the aliases a user registered after seeing the teach-set transcripts. */
function glossaryWithAliases(): GlossaryEntry[] {
  const aliases: Record<string, string[]> = JSON.parse(readFileSync(join(dataDir, 'aliases.json'), 'utf-8')).aliases
  return data.glossary.map((g) => (aliases[g.source]?.length ? { ...g, aliases: aliases[g.source] } : g))
}

function readWavPcm(path: string): Float32Array {
  const buf = readFileSync(path)
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      const samples = new Float32Array(size / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(off + 8 + i * 2) / 32768
      return samples
    }
    off += 8 + size + (size % 2)
  }
  throw new Error(`no data chunk in ${path}`)
}

async function runAsr(helper: string, modelDir: string, audioDir: string, outDir: string): Promise<void> {
  const proc = spawn(helper, [modelDir], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: proc.stdout! })
  const waiting: Array<(v: Record<string, unknown>) => void> = []
  lines.on('line', (line) => waiting.shift()?.(JSON.parse(line)))
  const next = (): Promise<Record<string, unknown>> => new Promise((r) => waiting.push(r))
  const ready = await next()
  if (!ready.ready) throw new Error(`helper failed: ${JSON.stringify(ready)}`)

  let id = 0
  const call = async (pcm: Float32Array, context: string): Promise<{ text: string; ms: number }> => {
    const req: Record<string, unknown> = { id: ++id, pcm_f32_b64: Buffer.from(pcm.buffer).toString('base64') }
    if (context) req.context = context
    const pending = next()
    proc.stdin!.write(JSON.stringify(req) + '\n')
    const reply = await pending
    if (typeof reply.error === 'string') throw new Error(reply.error)
    return { text: String(reply.text ?? '').trim(), ms: Number(reply.ms) }
  }

  const context = buildAsrContext(data.glossary)
  const rows: AsrRow[] = []
  let i = 0
  for (const u of utterances()) {
    const pcm = readWavPcm(join(audioDir, `${u.id}.wav`))
    // Alternate the order so warm-up or thermal drift does not favour one condition.
    const first = i++ % 2 === 0
    const a = first ? await call(pcm, '') : await call(pcm, context)
    const b = first ? await call(pcm, context) : await call(pcm, '')
    const [a0, a1] = first ? [a, b] : [b, a]
    rows.push({ id: u.id, set: u.set, lang: u.lang, a0: a0.text, a1: a1.text, a0Ms: a0.ms, a1Ms: a1.ms })
  }
  proc.stdin!.end()
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'asr.json'), JSON.stringify({ context, rows }, null, 1))
  console.log(`asr: ${rows.length} utterances, context ${context.length} chars`)
}

async function runMt(gguf: string, outDir: string): Promise<void> {
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp')
  const llama = await getLlama({ gpu: 'auto' })
  const model = await llama.loadModel({ modelPath: gguf })
  // Same context size and session handling as src/main/slm-worker.ts.
  const context = await model.createContext({ contextSize: 2048 })
  const session = new LlamaChatSession({ contextSequence: context.getSequence() })
  await session.preloadPrompt('warmup')
  session.resetChatHistory()

  const translate = async (text: string, to: string, glossary?: GlossaryEntry[]): Promise<{ text: string; ms: number }> => {
    const t0 = performance.now()
    session.resetChatHistory()
    const out = (await session.prompt(buildHyMt2Prompt(text, to, glossary ? { glossary } : undefined), { ...HY_MT2_INFERENCE_PARAMS })).trim()
    return { text: out, ms: performance.now() - t0 }
  }

  const asr: { rows: AsrRow[] } = JSON.parse(readFileSync(join(outDir, 'asr.json'), 'utf-8'))
  const withAliases = glossaryWithAliases()
  const rows: MtRow[] = []
  const memo = new Map<string, { t0: { text: string; ms: number }; t1: { text: string; ms: number } }>()
  let n = 0
  for (const r of asr.rows) {
    const to = r.lang === 'ja' ? 'en' : 'ja'
    for (const [variant, raw] of [['a0', r.a0], ['a1', r.a1]] as const) {
      for (const post of [false, true]) {
        const s = performance.now()
        const transcript = post ? correctTranscript(raw, withAliases) : raw
        const postUs = (performance.now() - s) * 1000
        const key = `${to}\u0000${transcript}`
        let res = memo.get(key)
        if (!res) {
          // Alternate the order: the session keeps the previous prompt's tokens, so a
          // second identical prompt (no term in the text) would otherwise look faster.
          if (n++ % 2 === 0) {
            const t0 = await translate(transcript, to)
            res = { t0, t1: await translate(transcript, to, data.glossary) }
          } else {
            const t1 = await translate(transcript, to, data.glossary)
            res = { t0: await translate(transcript, to), t1 }
          }
          memo.set(key, res)
        }
        rows.push({
          id: r.id,
          variant: `${variant}${post ? 'p1' : 'p0'}`,
          transcript,
          injected: buildHyMt2Prompt(transcript, to, { glossary: data.glossary }) !== buildHyMt2Prompt(transcript, to),
          t0: res.t0.text,
          t1: res.t1.text,
          t0Ms: res.t0.ms,
          t1Ms: res.t1.ms,
          postUs
        })
      }
    }
  }
  writeFileSync(join(outDir, 'mt.json'), JSON.stringify({ rows }, null, 1))
  console.log(`mt: ${rows.length} rows, ${memo.size} distinct transcripts translated twice`)
  await context.dispose()
  await model.dispose()
}

const lower = (s: string): string => s.toLowerCase()
function hits(text: string, expected: string[]): number {
  return expected.filter((e) => e.split('|').some((v) => lower(text).includes(lower(v)))).length
}
/**
 * Glossary terms in the output that the reference does not call for. References list
 * the distinctive part of a term ("Halcyon" for "Halcyon Platform"), so a term that
 * contains or is contained in an expected spelling is not an intrusion.
 */
function intrusions(text: string, u: Utterance): number {
  const allowed = [...u.expect, ...u.expectSrc].flatMap((e) => e.split('|')).map(lower)
  const all = data.terms.flatMap((t) => [t.ja, t.en]).map(lower)
  return all.filter((t) => !allowed.some((a) => a.includes(t) || t.includes(a)) && lower(text).includes(t)).length
}

/** Character units for Japanese, word units for English, ignoring punctuation, spacing and case. */
function units(text: string, lang: string): string[] {
  const t = text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ')
  return lang === 'ja' ? Array.from(t.replace(/\s+/g, '')) : t.split(/\s+/).filter(Boolean)
}
function editDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

function score(outDir: string): void {
  const asr: { rows: AsrRow[] } = JSON.parse(readFileSync(join(outDir, 'asr.json'), 'utf-8'))
  const mt: { rows: MtRow[] } = JSON.parse(readFileSync(join(outDir, 'mt.json'), 'utf-8'))
  const byId = new Map(utterances().map((u) => [u.id, u]))
  const conditions = [
    { name: '(a) none', variant: 'a0p0', mt: 't0' },
    { name: '(b1) ASR context', variant: 'a1p0', mt: 't0' },
    { name: '(b2) ASR alias replace', variant: 'a0p1', mt: 't0' },
    { name: '(b3) ASR context + alias replace', variant: 'a1p1', mt: 't0' },
    { name: '(c) MT prompt terms', variant: 'a0p0', mt: 't1' },
    { name: '(d1) ASR context + MT terms', variant: 'a1p0', mt: 't1' },
    { name: '(d2) alias replace + MT terms', variant: 'a0p1', mt: 't1' },
    { name: '(d3) ASR context + alias replace + MT terms', variant: 'a1p1', mt: 't1' }
  ] as const

  const metrics: Record<string, Record<string, unknown>> = {}
  for (const set of Object.keys(data.sets)) {
    metrics[set] = {}
    for (const c of conditions) {
      let src = 0, srcN = 0, tgt = 0, tgtN = 0, intrSrc = 0, intrTgt = 0, utts = 0, uttsWithIntr = 0
      for (const r of mt.rows.filter((x) => x.variant === c.variant && byId.get(x.id)?.set === set)) {
        const u = byId.get(r.id)!
        const translation = c.mt === 't1' ? r.t1 : r.t0
        src += hits(r.transcript, u.expectSrc); srcN += u.expectSrc.length
        tgt += hits(translation, u.expect); tgtN += u.expect.length
        const is = intrusions(r.transcript, u), it = intrusions(translation, u)
        intrSrc += is; intrTgt += it; utts++
        if (is + it > 0) uttsWithIntr++
      }
      metrics[set][c.name] = { src, srcN, tgt, tgtN, intrSrc, intrTgt, utts, uttsWithIntr }
    }
  }

  const a0Ms = asr.rows.map((r) => r.a0Ms), a1Ms = asr.rows.map((r) => r.a1Ms)
  const deltas = asr.rows.map((r) => r.a1Ms - r.a0Ms)
  const t0 = mt.rows.filter((r) => r.variant === 'a0p0').map((r) => r.t0Ms)
  const t1 = mt.rows.filter((r) => r.variant === 'a0p0').map((r) => r.t1Ms)
  // Only requests whose prompt actually carried glossary terms can cost more.
  const termRows = mt.rows.filter((r) => r.variant === 'a0p0' && r.injected)
  const latency = {
    asrMedianMs: { a0: median(a0Ms), a1: median(a1Ms), delta: median(deltas) },
    mtMedianMs: { t0: median(t0), t1: median(t1), delta: median(t1.map((v, i) => v - t0[i])) },
    mtMedianMsInjected: {
      n: termRows.length,
      t0: median(termRows.map((r) => r.t0Ms)),
      t1: median(termRows.map((r) => r.t1Ms)),
      delta: median(termRows.map((r) => r.t1Ms - r.t0Ms))
    },
    postReplaceMedianUs: median(mt.rows.filter((r) => r.variant.endsWith('p1')).map((r) => r.postUs))
  }
  // Error rate of the whole transcript (CER for Japanese, WER for English) shows damage
  // outside the terms, such as the context pulling an ordinary word towards a term.
  const errorRate: Record<string, Record<string, string>> = {}
  for (const set of Object.keys(data.sets)) {
    errorRate[set] = {}
    for (const variant of ['a0p0', 'a1p0', 'a0p1', 'a1p1']) {
      for (const lang of ['ja', 'en']) {
        let err = 0, len = 0
        for (const r of mt.rows.filter((x) => x.variant === variant && byId.get(x.id)?.set === set && byId.get(x.id)?.lang === lang)) {
          const ref = units(byId.get(r.id)!.text, lang)
          err += editDistance(units(r.transcript, lang), ref); len += ref.length
        }
        if (len) errorRate[set][`${variant}.${lang}`] = `${err}/${len} (${((100 * err) / len).toFixed(1)}%)`
      }
    }
  }
  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify({ metrics, latency, errorRate }, null, 1))

  const lines: string[] = []
  for (const set of Object.keys(data.sets)) {
    lines.push(`\n### ${set}\n`, '| condition | source terms | translation terms | utterances with an intruding term |', '|---|---|---|---|')
    for (const c of conditions) {
      const m = metrics[set][c.name] as Record<string, number>
      const pct = (a: number, b: number): string => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '—')
      lines.push(`| ${c.name} | ${pct(m.src, m.srcN)} | ${pct(m.tgt, m.tgtN)} | ${m.uttsWithIntr}/${m.utts} |`)
    }
  }
  lines.push('', '```json', JSON.stringify({ latency, errorRate }, null, 1), '```')
  writeFileSync(join(outDir, 'metrics.md'), lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'asr') await runAsr(args[0], args[1], args[2], args[3])
else if (cmd === 'mt') await runMt(args[0], args[1])
else if (cmd === 'score') score(args[0])
else {
  console.error('usage: bench.mjs asr|mt|score ...')
  process.exit(2)
}
