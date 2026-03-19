import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { BenchmarkEngine, Direction } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models', 'transformers')

type TranslationPipeline = (text: string) => Promise<Array<{ translation_text: string }>>

export class OpusMTBench implements BenchmarkEngine {
  readonly id = 'opus-mt'
  readonly label = 'OPUS-MT (Offline)'

  private jaToEn: TranslationPipeline | null = null
  private enToJa: TranslationPipeline | null = null

  async initialize(): Promise<void> {
    if (this.jaToEn && this.enToJa) return

    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = MODELS_DIR

    console.log('[opus-mt] Loading JA→EN model...')
    this.jaToEn = (await pipeline('translation', 'Xenova/opus-mt-ja-en', {
      dtype: 'q8'
    })) as unknown as TranslationPipeline

    console.log('[opus-mt] Loading EN→JA model...')
    this.enToJa = (await pipeline('translation', 'Xenova/opus-mt-en-jap', {
      dtype: 'q8'
    })) as unknown as TranslationPipeline

    console.log('[opus-mt] Models loaded')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''

    const pipe = direction === 'ja-en' ? this.jaToEn : this.enToJa
    if (!pipe) {
      throw new Error(`[opus-mt] Pipeline not initialized for ${direction}`)
    }

    const result = await pipe(text)
    return result[0]?.translation_text || ''
  }

  async dispose(): Promise<void> {
    this.jaToEn = null
    this.enToJa = null
  }
}
