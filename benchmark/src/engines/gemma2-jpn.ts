import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { BenchmarkEngine, Direction } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models')
const DEFAULT_MODEL_FILE = 'gemma-2-2b-jpn-it-translate-Q4_K_M.gguf'

const LANG_MAP: Record<string, string> = {
  ja: 'Japanese',
  en: 'English'
}

interface Gemma2JpnBenchOptions {
  modelFile?: string
  useGpu?: boolean
}

/**
 * Gemma-2-2B-JPN-IT-Translate benchmark engine via node-llama-cpp.
 * Uses the same prompt format as the app's slm-worker.ts.
 */
export class Gemma2JpnBench implements BenchmarkEngine {
  readonly id: string
  readonly label: string

  private modelPath: string
  private useGpu: boolean
  private llama: any = null
  private model: any = null
  private context: any = null

  constructor(options?: Gemma2JpnBenchOptions) {
    const modelFile = options?.modelFile ?? DEFAULT_MODEL_FILE
    this.modelPath = join(MODELS_DIR, modelFile)
    this.useGpu = options?.useGpu ?? true
    this.id = this.useGpu ? 'gemma2-jpn-gpu' : 'gemma2-jpn-cpu'
    this.label = this.useGpu ? 'Gemma-2-2B JA↔EN (GPU)' : 'Gemma-2-2B JA↔EN (CPU)'
  }

  async initialize(): Promise<void> {
    if (this.context) return

    if (!existsSync(this.modelPath)) {
      throw new Error(
        `Model file not found: ${this.modelPath}\n` +
          'Download from HuggingFace: huggingface-cli download ' +
          'mmnga/gemma-2-2b-jpn-it-translate-gguf gemma-2-2b-jpn-it-translate-Q4_K_M.gguf ' +
          `--local-dir ${MODELS_DIR}`
      )
    }

    console.log(`[gemma2-jpn] Loading model (GPU: ${this.useGpu})...`)

    const { getLlama } = await import('node-llama-cpp')
    this.llama = await getLlama({ gpu: this.useGpu ? 'auto' : false })
    this.model = await this.llama.loadModel({ modelPath: this.modelPath })
    this.context = await this.model.createContext({ contextSize: 2048 })

    console.log('[gemma2-jpn] Model loaded')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''
    if (!this.context) {
      throw new Error('[gemma2-jpn] Not initialized')
    }

    const [fromCode, toCode] = direction.split('-') as [string, string]
    const fromLang = LANG_MAP[fromCode] ?? fromCode
    const toLang = LANG_MAP[toCode] ?? toCode

    // Gemma-2-JPN prompt: simple translation instruction (same as slm-worker.ts for gemma2-jpn)
    const prompt = `Translate the following text from ${fromLang} to ${toLang}. Output only the translation, nothing else.\n\n${text}`

    const { LlamaChatSession } = await import('node-llama-cpp')
    const session = new LlamaChatSession({ contextSequence: this.context.getSequence() })

    const response = await session.prompt(prompt, {
      temperature: 0.1,
      maxTokens: 512
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
