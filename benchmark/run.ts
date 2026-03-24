import type { BenchmarkEngine, Direction } from './src/types.js'
import { runBenchmark } from './src/runner.js'
import { writeReports } from './src/report.js'

const AVAILABLE_ENGINES = [
  'google',
  'deepl',
  'microsoft',
  'gemini',
  'opus-mt',
  'ct2-opus-mt',
  'ct2-madlad400',
  'translate-gemma',
  'translate-gemma-cpu',
  'hunyuan-mt',
  'hunyuan-mt-cpu',
  'hunyuan-mt-15',
  'hunyuan-mt-15-cpu',
  'alma-ja',
  'alma-ja-cpu',
  'gemma2-jpn',
  'gemma2-jpn-cpu'
] as const
type EngineId = (typeof AVAILABLE_ENGINES)[number]

function parseArgs(): { engines: EngineId[]; directions: Direction[] } {
  const args = process.argv.slice(2)
  let engines: EngineId[] = []
  let directions: Direction[] = ['ja-en', 'en-ja']

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--engines' && args[i + 1]) {
      engines = args[i + 1]!.split(',').map((e) => {
        const trimmed = e.trim() as EngineId
        if (!AVAILABLE_ENGINES.includes(trimmed)) {
          console.error(`Unknown engine: ${trimmed}`)
          console.error(`Available: ${AVAILABLE_ENGINES.join(', ')}`)
          process.exit(1)
        }
        return trimmed
      })
      i++
    } else if (arg === '--direction' && args[i + 1]) {
      directions = [args[i + 1]! as Direction]
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx --expose-gc run.ts [options]')
      console.log('')
      console.log('Options:')
      console.log(`  --engines <list>     Comma-separated engines (${AVAILABLE_ENGINES.join(', ')})`)
      console.log('  --direction <dir>    ja-en or en-ja (default: both)')
      console.log('  --help               Show this help')
      process.exit(0)
    }
  }

  if (engines.length === 0) {
    // Default: only the original engines (API keys / models may not be available for all)
    engines = ['google', 'opus-mt', 'translate-gemma', 'translate-gemma-cpu']
  }

  return { engines, directions }
}

async function createEngine(id: EngineId): Promise<BenchmarkEngine> {
  switch (id) {
    case 'google': {
      const { GoogleTranslateBench } = await import('./src/engines/google-translate.js')
      return new GoogleTranslateBench()
    }
    case 'deepl': {
      const { DeepLBench } = await import('./src/engines/deepl.js')
      return new DeepLBench()
    }
    case 'microsoft': {
      const { MicrosoftBench } = await import('./src/engines/microsoft.js')
      return new MicrosoftBench()
    }
    case 'gemini': {
      const { GeminiBench } = await import('./src/engines/gemini.js')
      return new GeminiBench()
    }
    case 'opus-mt': {
      const { OpusMTBench } = await import('./src/engines/opus-mt.js')
      return new OpusMTBench()
    }
    case 'ct2-opus-mt': {
      const { CT2OpusMTBench } = await import('./src/engines/ct2-opus-mt.js')
      return new CT2OpusMTBench()
    }
    case 'ct2-madlad400': {
      const { CT2Madlad400Bench } = await import('./src/engines/ct2-madlad400.js')
      return new CT2Madlad400Bench()
    }
    case 'translate-gemma': {
      const { TranslateGemmaBench } = await import('./src/engines/translate-gemma.js')
      return new TranslateGemmaBench({ useGpu: true })
    }
    case 'translate-gemma-cpu': {
      const { TranslateGemmaBench } = await import('./src/engines/translate-gemma.js')
      return new TranslateGemmaBench({ useGpu: false })
    }
    case 'hunyuan-mt': {
      const { HunyuanMTBench } = await import('./src/engines/hunyuan-mt.js')
      return new HunyuanMTBench({ useGpu: true })
    }
    case 'hunyuan-mt-cpu': {
      const { HunyuanMTBench } = await import('./src/engines/hunyuan-mt.js')
      return new HunyuanMTBench({ useGpu: false })
    }
    case 'hunyuan-mt-15': {
      const { HunyuanMT15Bench } = await import('./src/engines/hunyuan-mt-15.js')
      return new HunyuanMT15Bench({ useGpu: true })
    }
    case 'hunyuan-mt-15-cpu': {
      const { HunyuanMT15Bench } = await import('./src/engines/hunyuan-mt-15.js')
      return new HunyuanMT15Bench({ useGpu: false })
    }
    case 'alma-ja': {
      const { AlmaJaBench } = await import('./src/engines/alma-ja.js')
      return new AlmaJaBench({ useGpu: true })
    }
    case 'alma-ja-cpu': {
      const { AlmaJaBench } = await import('./src/engines/alma-ja.js')
      return new AlmaJaBench({ useGpu: false })
    }
    case 'gemma2-jpn': {
      const { Gemma2JpnBench } = await import('./src/engines/gemma2-jpn.js')
      return new Gemma2JpnBench({ useGpu: true })
    }
    case 'gemma2-jpn-cpu': {
      const { Gemma2JpnBench } = await import('./src/engines/gemma2-jpn.js')
      return new Gemma2JpnBench({ useGpu: false })
    }
  }
}

async function main(): Promise<void> {
  const { engines: engineIds, directions } = parseArgs()

  console.log('=== Translation Quality Benchmark ===')
  console.log(`Engines: ${engineIds.join(', ')}`)
  console.log(`Directions: ${directions.join(', ')}`)
  console.log('')

  const engines: BenchmarkEngine[] = []
  for (const id of engineIds) {
    try {
      engines.push(await createEngine(id))
    } catch (err) {
      console.error(`[main] Failed to create engine '${id}':`, err)
    }
  }

  if (engines.length === 0) {
    console.error('No engines available. Exiting.')
    process.exit(1)
  }

  const result = await runBenchmark(engines, directions)
  const outputDir = writeReports(result)

  console.log(`\nDone. Results written to ${outputDir}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
