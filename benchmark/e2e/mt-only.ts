/**
 * Translator-only run: translates each utterance's ground-truth text, with no ASR,
 * VAD or context, so translator quality can be compared apart from ASR errors.
 *
 *   node benchmark/e2e/dist/mt-only.js --mt <hy-mt15|hy-mt2> --session <json> --out <file.comet.jsonl> [--glossary <json>]
 */
import { readFileSync, writeFileSync } from 'fs'
import { HunyuanMT15Translator } from '../../src/engines/translator/HunyuanMT15Translator'
import type { GlossaryEntry } from '../../src/engines/types'
import { HyMT2Translator } from './engines/HyMT2Translator'
import { MemSampler } from './mem-sampler'
import { percentile, type Utterance } from './score-lib'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const mtId = arg('mt') ?? 'hy-mt2'
  const session = JSON.parse(readFileSync(arg('session')!, 'utf8')) as { utterances: Utterance[] }
  const out = arg('out')!
  const glossaryPath = arg('glossary')
  const glossary: GlossaryEntry[] | undefined = glossaryPath ? JSON.parse(readFileSync(glossaryPath, 'utf8')) : undefined

  const mem = new MemSampler()
  mem.start()
  const t = mtId === 'hy-mt15' ? new HunyuanMT15Translator() : new HyMT2Translator()
  await t.initialize()
  // Warm the context the same way run-e2e.ts does, outside the timed loop.
  await t.translate('来週の定例は火曜日に変更します。', 'ja', 'en')

  const lines: string[] = []
  const ms: number[] = []
  for (const u of session.utterances) {
    const to = u.lang === 'ja' ? 'en' : 'ja'
    const s0 = performance.now()
    const mt = await t.translate(u.text, u.lang, to, glossary ? { previousSegments: [], glossary } : undefined)
    ms.push(performance.now() - s0)
    lines.push(JSON.stringify({ id: u.id, lang: u.lang, src: u.text, mt, ref: u.ref, ms: Math.round(ms[ms.length - 1]) }))
  }
  writeFileSync(out, lines.join('\n') + '\n')
  await t.dispose()
  const m = await mem.stop()
  console.log(
    `RESULT ${out} n=${lines.length} p50=${Math.round(percentile(ms, 0.5)!)}ms p90=${Math.round(percentile(ms, 0.9)!)}ms` +
      ` peakRss=${(m.peakRssBytes / 2 ** 30).toFixed(2)}GB`
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
