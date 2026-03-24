import { app } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language } from '../types'

// Dynamic import for ESM-only @huggingface/transformers
type TranslationPipeline = ((text: string) => Promise<Array<{ translation_text: string }>>) & {
  dispose(): Promise<void>
}

export class OpusMTTranslator implements TranslatorEngine {
  readonly id = 'opus-mt'
  readonly name = 'OPUS-MT (Offline)'
  readonly isOffline = true

  private jaToEn: TranslationPipeline | null = null
  private enToJa: TranslationPipeline | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.jaToEn && this.enToJa) return

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
      this.initPromise = null
      throw err
    }
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    // Filter too-short input that causes hallucinations
    const trimmed = text.trim()
    if (trimmed.length < 3) return ''

    const pipe = from === 'ja' ? this.jaToEn : this.enToJa
    if (!pipe) {
      console.error(`[opus-mt] Pipeline not initialized for ${from}→${to}`)
      return ''
    }

    const result = await pipe(text)
    const translated = result[0]?.translation_text || ''

    // Detect hallucination: if output is much longer than input, likely garbage
    if (translated.length > trimmed.length * 5 && trimmed.length < 20) {
      console.warn(`[opus-mt] Hallucination detected: "${trimmed}" → "${translated.substring(0, 50)}..." (filtered)`)
      return ''
    }

    return translated
  }

  async dispose(): Promise<void> {
    console.log('[opus-mt] Disposing resources')
    try {
      await Promise.all([
        this.jaToEn?.dispose(),
        this.enToJa?.dispose()
      ])
    } catch (err) {
      console.error('[opus-mt] Error during pipeline disposal:', err)
    }
    this.jaToEn = null
    this.enToJa = null
  }
}
