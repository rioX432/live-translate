import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { BenchmarkEngine, Direction } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models')
const DEFAULT_MODEL_FILE = 'CAT-Translate-1.4b.Q4_K_M.gguf'

const LANG_MAP: Record<string, string> = {
  ja: 'Japanese',
  en: 'English'
}

interface CATTranslateBenchOptions {
  modelFile?: string
  useGpu?: boolean
}

/**
 * CAT-Translate-1.4B benchmark engine via node-llama-cpp (#406).
 * CyberAgent's JA↔EN specialized translation model based on Sarashina2.2-1b.
 * Prompt format: "Translate the following {src_lang} text into {tgt_lang}.\n\n{text}"
 */
export class CATTranslateBench implements BenchmarkEngine {
  readonly id: string
  readonly label: string

  private modelPath: string
  private useGpu: boolean
  private llama: any = null
  private model: any = null
  private context: any = null
  private session: any = null

  constructor(options?: CATTranslateBenchOptions) {
    const modelFile = options?.modelFile ?? DEFAULT_MODEL_FILE
    this.modelPath = join(MODELS_DIR, modelFile)
    this.useGpu = options?.useGpu ?? true
    this.id = this.useGpu ? 'cat-translate-gpu' : 'cat-translate-cpu'
    this.label = this.useGpu ? 'CAT-Translate 1.4B (GPU)' : 'CAT-Translate 1.4B (CPU)'
  }

  async initialize(): Promise<void> {
    if (this.context) return

    if (!existsSync(this.modelPath)) {
      throw new Error(
        `Model file not found: ${this.modelPath}\n` +
          'Download: huggingface-cli download ' +
          'mradermacher/CAT-Translate-1.4b-GGUF CAT-Translate-1.4b.Q4_K_M.gguf ' +
          `--local-dir ${MODELS_DIR}`
      )
    }

    console.log(`[cat-translate] Loading model (GPU: ${this.useGpu})...`)

    const { getLlama } = await import('node-llama-cpp')
    this.llama = await getLlama({ gpu: this.useGpu ? 'auto' : false })
    this.model = await this.llama.loadModel({ modelPath: this.modelPath })
    this.context = await this.model.createContext({ contextSize: 2048 })

    const { LlamaChatSession } = await import('node-llama-cpp')
    this.session = new LlamaChatSession({ contextSequence: this.context.getSequence() })

    console.log('[cat-translate] Model loaded')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''
    if (!this.session) {
      throw new Error('[cat-translate] Not initialized')
    }

    const [fromCode, toCode] = direction.split('-') as [string, string]
    const srcLang = LANG_MAP[fromCode] ?? fromCode
    const tgtLang = LANG_MAP[toCode] ?? toCode

    // CAT-Translate prompt format (from model card)
    const prompt = `Translate the following ${srcLang} text into ${tgtLang}.\n\n${text}`

    // Reset session context for each independent translation
    this.session.resetChatHistory()

    const response = await this.session.prompt(prompt, {
      temperature: 0.1,
      maxTokens: 512
    })

    return response.trim()
  }

  async dispose(): Promise<void> {
    if (this.session) {
      this.session.dispose?.()
      this.session = null
    }
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
