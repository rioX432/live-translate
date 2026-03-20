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
  private initializing = false
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.jaToEn && this.enToJa) return
    if (this.initializing) return
    this.initializing = true

    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(app.getPath('userData'), 'models', 'transformers')

    try {
      this.onProgress?.('Loading JA→EN translation model...')
      // Use local variables to avoid leaking partial state on failure (#207)
      const jaToEn = (await pipeline('translation', 'Xenova/opus-mt-ja-en', {
        dtype: 'q8'
      })) as unknown as TranslationPipeline

      this.onProgress?.('Loading EN→JA translation model...')
      const enToJa = (await pipeline('translation', 'Xenova/opus-mt-en-jap', {
        dtype: 'q8'
      })) as unknown as TranslationPipeline

      // Only assign after both succeed
      this.jaToEn = jaToEn
      this.enToJa = enToJa
      this.onProgress?.('OPUS-MT models loaded')
    } catch (err) {
      this.jaToEn = null
      this.enToJa = null
      throw err
    } finally {
      this.initializing = false
    }
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    const pipe = from === 'ja' ? this.jaToEn : this.enToJa
    if (!pipe) {
      console.error(`[opus-mt] Pipeline not initialized for ${from}→${to}`)
      return ''
    }

    const result = await pipe(text)
    return result[0]?.translation_text || ''
  }

  async dispose(): Promise<void> {
    console.log('[opus-mt] Disposing resources')
    this.jaToEn = null
    this.enToJa = null
  }
}
