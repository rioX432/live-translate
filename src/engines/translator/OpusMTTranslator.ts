import { app } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { isHallucination } from './hallucination-filter'
import { applyGlossary } from './glossary-utils'
import { createLogger } from '../../main/logger'

const log = createLogger('opus-mt')

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

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    // Filter too-short input that causes hallucinations
    const trimmed = text.trim()
    if (trimmed.length < 3) return ''

    // Apply glossary term replacements before translation
    const input = applyGlossary(text, context?.glossary)

    const pipe = from === 'ja' ? this.jaToEn : this.enToJa
    if (!pipe) {
      log.error(`Pipeline not initialized for ${from}→${to}`)
      return ''
    }

    const result = await pipe(input)
    const translated = result[0]?.translation_text || ''

    if (isHallucination(trimmed, translated, from, to)) {
      log.warn(`Hallucination detected: "${trimmed}" → "${translated.substring(0, 80)}..." (filtered)`)
      return ''
    }

    return translated
  }

  async dispose(): Promise<void> {
    log.info('Disposing resources')
    try {
      await Promise.all([
        this.jaToEn?.dispose(),
        this.enToJa?.dispose()
      ])
    } catch (err) {
      log.error('Error during pipeline disposal:', err)
    }
    this.jaToEn = null
    this.enToJa = null
  }
}
