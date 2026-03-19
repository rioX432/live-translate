import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { BenchmarkEngine, Direction } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models')
const DEFAULT_MODEL_FILE = 'translategemma-4b-it-Q4_K_M.gguf'

const LANG_MAP: Record<string, string> = {
  ja: 'Japanese',
  en: 'English'
}

interface TranslateGemmaOptions {
  modelFile?: string
  useGpu?: boolean
}

export class TranslateGemmaBench implements BenchmarkEngine {
  readonly id: string
  readonly label: string

  private modelPath: string
  private useGpu: boolean
  private llama: any = null
  private model: any = null
  private context: any = null
  private session: any = null

  constructor(options?: TranslateGemmaOptions) {
    const modelFile = options?.modelFile ?? DEFAULT_MODEL_FILE
    this.modelPath = join(MODELS_DIR, modelFile)
    this.useGpu = options?.useGpu ?? true
    this.id = this.useGpu ? 'translate-gemma-gpu' : 'translate-gemma-cpu'
    this.label = this.useGpu ? 'TranslateGemma 4B (GPU)' : 'TranslateGemma 4B (CPU)'
  }

  async initialize(): Promise<void> {
    if (this.session) return

    if (!existsSync(this.modelPath)) {
      throw new Error(
        `Model file not found: ${this.modelPath}\n` +
          'Download from HuggingFace: huggingface-cli download ' +
          'google/translategemma-4b-it-GGUF translategemma-4b-it-Q4_K_M.gguf ' +
          `--local-dir ${MODELS_DIR}`
      )
    }

    console.log(`[translate-gemma] Loading model (GPU: ${this.useGpu})...`)

    const { getLlama } = await import('node-llama-cpp')
    this.llama = await getLlama({ gpu: this.useGpu ? 'auto' : false })
    this.model = await this.llama.loadModel({ modelPath: this.modelPath })
    this.context = await this.model.createContext()

    const { LlamaChatSession } = await import('node-llama-cpp')
    this.session = new LlamaChatSession({ contextSequence: this.context.getSequence() })

    console.log('[translate-gemma] Model loaded')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''
    if (!this.session) {
      throw new Error('[translate-gemma] Not initialized')
    }

    const [fromCode, toCode] = direction.split('-') as [string, string]
    const fromLang = LANG_MAP[fromCode] ?? fromCode
    const toLang = LANG_MAP[toCode] ?? toCode

    // TranslateGemma expects a specific prompt format
    const prompt = `<translate>${text}</translate>\nTranslate the above text from ${fromLang} to ${toLang}.`

    // Reset session context for each independent translation
    this.session.resetChatHistory()

    const response = await this.session.prompt(prompt)

    // Strip any XML tags or extra whitespace from the response
    return response.replace(/<\/?translate>/g, '').trim()
  }

  async dispose(): Promise<void> {
    this.session = null
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
