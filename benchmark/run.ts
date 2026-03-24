import type { BenchmarkEngine, Direction } from './src/types.js'
import type { STTBenchmarkEngine, STTLanguage } from './src/stt-types.js'
import { runBenchmark } from './src/runner.js'
import { writeReports } from './src/report.js'
import { runSTTBenchmark } from './src/stt-runner.js'
import { writeSTTReports } from './src/stt-report.js'

// ── Translation engines ──

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

// ── STT engines ──

const AVAILABLE_STT_ENGINES = [
  'whisper-local',
  'mlx-whisper',
  'lightning-whisper',
  'moonshine',
  'sensevoice',
  'qwen-asr',
  'sherpa-onnx'
] as const
type STTEngineId = (typeof AVAILABLE_STT_ENGINES)[number]

// ── Arg parsing ──

interface ParsedArgs {
  mode: 'translate' | 'stt'
  engines: EngineId[]
  sttEngines: STTEngineId[]
  directions: Direction[]
  sttLanguages: (STTLanguage | 'all')[]
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  let mode: 'translate' | 'stt' = 'translate'
  let engines: EngineId[] = []
  let sttEngines: STTEngineId[] = []
  let directions: Direction[] = ['ja-en', 'en-ja']
  let sttLanguages: (STTLanguage | 'all')[] = ['ja', 'en', 'all']

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--stt') {
      mode = 'stt'
    } else if (arg === '--engines' && args[i + 1]) {
      if (mode === 'stt') {
        sttEngines = args[i + 1]!.split(',').map((e) => {
          const trimmed = e.trim() as STTEngineId
          if (!AVAILABLE_STT_ENGINES.includes(trimmed)) {
            console.error(`Unknown STT engine: ${trimmed}`)
            console.error(`Available: ${AVAILABLE_STT_ENGINES.join(', ')}`)
            process.exit(1)
          }
          return trimmed
        })
      } else {
        engines = args[i + 1]!.split(',').map((e) => {
          const trimmed = e.trim() as EngineId
          if (!AVAILABLE_ENGINES.includes(trimmed)) {
            console.error(`Unknown engine: ${trimmed}`)
            console.error(`Available: ${AVAILABLE_ENGINES.join(', ')}`)
            process.exit(1)
          }
          return trimmed
        })
      }
      i++
    } else if (arg === '--direction' && args[i + 1]) {
      directions = [args[i + 1]! as Direction]
      i++
    } else if (arg === '--language' && args[i + 1]) {
      sttLanguages = [args[i + 1]! as STTLanguage | 'all']
      i++
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx --expose-gc run.ts [options]')
      console.log('')
      console.log('Translation benchmark (default):')
      console.log(`  --engines <list>     Comma-separated engines (${AVAILABLE_ENGINES.join(', ')})`)
      console.log('  --direction <dir>    ja-en or en-ja (default: both)')
      console.log('')
      console.log('STT benchmark:')
      console.log('  --stt                Run STT benchmark instead of translation')
      console.log(`  --engines <list>     Comma-separated STT engines (${AVAILABLE_STT_ENGINES.join(', ')})`)
      console.log('  --language <lang>    ja, en, or all (default: all three)')
      console.log('')
      console.log('  --help               Show this help')
      process.exit(0)
    }
  }

  // Defaults
  if (mode === 'translate' && engines.length === 0) {
    engines = ['google', 'opus-mt', 'translate-gemma', 'translate-gemma-cpu']
  }
  if (mode === 'stt' && sttEngines.length === 0) {
    sttEngines = ['whisper-local', 'mlx-whisper']
  }

  return { mode, engines, sttEngines, directions, sttLanguages }
}

// ── Engine factories ──

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

async function createSTTEngine(id: STTEngineId): Promise<STTBenchmarkEngine> {
  switch (id) {
    case 'whisper-local': {
      const { WhisperLocalBench } = await import('./src/stt-engines/whisper-local.js')
      return new WhisperLocalBench()
    }
    case 'mlx-whisper': {
      const { MLXWhisperBench } = await import('./src/stt-engines/mlx-whisper.js')
      return new MLXWhisperBench()
    }
    case 'lightning-whisper': {
      const { LightningWhisperBench } = await import('./src/stt-engines/lightning-whisper.js')
      return new LightningWhisperBench()
    }
    case 'moonshine': {
      const { MoonshineBench } = await import('./src/stt-engines/moonshine.js')
      return new MoonshineBench()
    }
    case 'sensevoice': {
      const { SenseVoiceBench } = await import('./src/stt-engines/sensevoice.js')
      return new SenseVoiceBench()
    }
    case 'qwen-asr': {
      const { QwenASRBench } = await import('./src/stt-engines/qwen-asr.js')
      return new QwenASRBench()
    }
    case 'sherpa-onnx': {
      const { SherpaOnnxBench } = await import('./src/stt-engines/sherpa-onnx.js')
      return new SherpaOnnxBench()
    }
  }
}

// ── Main ──

async function runTranslationMode(
  engineIds: EngineId[],
  directions: Direction[]
): Promise<void> {
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

async function runSTTMode(
  engineIds: STTEngineId[],
  languages: (STTLanguage | 'all')[]
): Promise<void> {
  console.log('=== STT Benchmark ===')
  console.log(`Engines: ${engineIds.join(', ')}`)
  console.log(`Languages: ${languages.join(', ')}`)
  console.log('')

  const engines: STTBenchmarkEngine[] = []
  for (const id of engineIds) {
    try {
      engines.push(await createSTTEngine(id))
    } catch (err) {
      console.error(`[main] Failed to create STT engine '${id}':`, err)
    }
  }

  if (engines.length === 0) {
    console.error('No STT engines available. Exiting.')
    process.exit(1)
  }

  const result = await runSTTBenchmark(engines, languages)
  const outputDir = writeSTTReports(result)
  console.log(`\nDone. Results written to ${outputDir}`)
}

async function main(): Promise<void> {
  const parsed = parseArgs()

  if (parsed.mode === 'stt') {
    await runSTTMode(parsed.sttEngines, parsed.sttLanguages)
  } else {
    await runTranslationMode(parsed.engines, parsed.directions)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
