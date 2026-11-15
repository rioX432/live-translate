/**
 * Loads a translator through the real worker-pool + slm-worker and translates a
 * few sentences. Usage: node dist/smoke-mt.js <hy-mt15|hy-mt2>
 */
import { HunyuanMT15Translator } from '../../src/engines/translator/HunyuanMT15Translator'
import { HyMT2Translator } from './engines/HyMT2Translator'
import { MemSampler } from './mem-sampler'

const SENTENCES: { text: string; from: 'ja' | 'en'; to: 'ja' | 'en' }[] = [
  { text: '来週の定例は火曜日の午後三時からに変更します。', from: 'ja', to: 'en' },
  { text: 'この機能はまだリリースしないでください。', from: 'ja', to: 'en' },
  { text: 'We should not ship the build until QA signs off.', from: 'en', to: 'ja' },
  { text: 'The latency dropped from 2.4 seconds to 800 milliseconds.', from: 'en', to: 'ja' }
]

async function main(): Promise<void> {
  const which = process.argv[2] ?? 'hy-mt2'
  const mem = new MemSampler()
  mem.start()
  const t = which === 'hy-mt15' ? new HunyuanMT15Translator() : new HyMT2Translator()
  const t0 = performance.now()
  await t.initialize()
  const loadMs = performance.now() - t0
  const rows = []
  for (const s of SENTENCES) {
    const s0 = performance.now()
    const out = await t.translate(s.text, s.from, s.to)
    rows.push({ ms: Math.round(performance.now() - s0), src: s.text, out })
  }
  await t.dispose()
  const m = await mem.stop()
  console.log('RESULT ' + JSON.stringify({ engine: t.id, loadMs: Math.round(loadMs), rows, mem: m }))
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
