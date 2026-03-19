import type { BenchmarkEngine, Direction } from './src/types.js'
import { runBenchmark } from './src/runner.js'
import { writeReports } from './src/report.js'

const AVAILABLE_ENGINES = ['google', 'opus-mt', 'translate-gemma', 'translate-gemma-cpu'] as const
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
    case 'opus-mt': {
      const { OpusMTBench } = await import('./src/engines/opus-mt.js')
      return new OpusMTBench()
    }
    case 'translate-gemma': {
      const { TranslateGemmaBench } = await import('./src/engines/translate-gemma.js')
      return new TranslateGemmaBench({ useGpu: true })
    }
    case 'translate-gemma-cpu': {
      const { TranslateGemmaBench } = await import('./src/engines/translate-gemma.js')
      return new TranslateGemmaBench({ useGpu: false })
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
