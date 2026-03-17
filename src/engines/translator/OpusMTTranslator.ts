import { app } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language } from '../types'

// Dynamic import for ESM-only @huggingface/transformers
type TranslationPipeline = (text: string) => Promise<Array<{ translation_text: string }>>

export class OpusMTTranslator implements TranslatorEngine {
  readonly id = 'opus-mt'
  readonly name = 'OPUS-MT (Offline)'
  readonly isOffline = true

  private jaToEn: TranslationPipeline | null = null
  private enToJa: TranslationPipeline | null = null
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.jaToEn && this.enToJa) return

    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(app.getPath('userData'), 'models', 'transformers')

    this.onProgress?.('Loading JA→EN translation model...')
    this.jaToEn = (await pipeline('translation', 'Xenova/opus-mt-ja-en', {
      dtype: 'q8'
    })) as unknown as TranslationPipeline

    this.onProgress?.('Loading EN→JA translation model...')
    this.enToJa = (await pipeline('translation', 'Xenova/opus-mt-en-jap', {
      dtype: 'q8'
    })) as unknown as TranslationPipeline

    this.onProgress?.('OPUS-MT models loaded')
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''

    const pipe = from === 'ja' ? this.jaToEn : this.enToJa
    if (!pipe) throw new Error(`OPUS-MT pipeline not initialized for ${from}→${to}`)

    const result = await pipe(text)
    return result[0]?.translation_text || ''
  }

  async dispose(): Promise<void> {
    this.jaToEn = null
    this.enToJa = null
  }
}
