import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { BenchmarkEngine, Direction } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models')
const DEFAULT_MODEL_FILE = 'Hunyuan-MT-7B-q4_k_m.gguf'

const LANG_MAP: Record<string, string> = {
  ja: 'Japanese',
  en: 'English'
}

interface HunyuanMTBenchOptions {
  modelFile?: string
  useGpu?: boolean
}

/**
 * Hunyuan-MT 7B benchmark engine via node-llama-cpp.
 * Uses the same prompt format as the app's slm-worker.ts.
 */
export class HunyuanMTBench implements BenchmarkEngine {
  readonly id: string
  readonly label: string

  private modelPath: string
  private useGpu: boolean
  private llama: any = null
  private model: any = null
  private context: any = null

  constructor(options?: HunyuanMTBenchOptions) {
    const modelFile = options?.modelFile ?? DEFAULT_MODEL_FILE
    this.modelPath = join(MODELS_DIR, modelFile)
    this.useGpu = options?.useGpu ?? true
    this.id = this.useGpu ? 'hunyuan-mt-gpu' : 'hunyuan-mt-cpu'
    this.label = this.useGpu ? 'Hunyuan-MT 7B (GPU)' : 'Hunyuan-MT 7B (CPU)'
  }

  async initialize(): Promise<void> {
    if (this.context) return

    if (!existsSync(this.modelPath)) {
      throw new Error(
        `Model file not found: ${this.modelPath}\n` +
          'Download from HuggingFace: huggingface-cli download ' +
          'tencent/Hunyuan-MT-GGUF Hunyuan-MT-7B-q4_k_m.gguf ' +
          `--local-dir ${MODELS_DIR}`
      )
    }

    console.log(`[hunyuan-mt] Loading model (GPU: ${this.useGpu})...`)

    const { getLlama } = await import('node-llama-cpp')
    this.llama = await getLlama({ gpu: this.useGpu ? 'auto' : false })
    this.model = await this.llama.loadModel({ modelPath: this.modelPath })
    this.context = await this.model.createContext({ contextSize: 2048 })

    console.log('[hunyuan-mt] Model loaded')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''
    if (!this.context) {
      throw new Error('[hunyuan-mt] Not initialized')
    }

    const [, toCode] = direction.split('-') as [string, string]
    const toLang = LANG_MAP[toCode] ?? toCode

    // Hunyuan-MT prompt format: for non-Chinese language pairs, use English prompt
    const prompt = `Translate the following segment into ${toLang}, without additional explanation.\n\n${text}`

    const { LlamaChatSession } = await import('node-llama-cpp')
    const session = new LlamaChatSession({ contextSequence: this.context.getSequence() })

    const response = await session.prompt(prompt, {
      temperature: 0.7,
      maxTokens: 512,
      topK: 20,
      topP: 0.6,
      repeatPenalty: { penalty: 1.05 }
    })

    session.dispose?.()
    return response.trim()
  }

  async dispose(): Promise<void> {
    if (this.context) {
      await this.context.dispose?.()
      this.context = null
    }
    if (this.model) {
      await this.model.dispose?.()
      this.model = null
    }
    this.llama = null
  }
}
