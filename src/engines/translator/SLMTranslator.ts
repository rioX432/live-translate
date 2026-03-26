import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, getGGUFVariants, isGGUFDownloaded } from '../model-downloader'
import type { SLMModelSize } from '../model-downloader'
import { workerPool } from '../../main/worker-pool'

export class SLMTranslator implements TranslatorEngine {
  readonly id = 'slm-translate'
  readonly name: string
  readonly isOffline = true

  private initialized = false
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private variant: string
  private modelSize: SLMModelSize
  private kvCacheQuant: boolean
  private speculativeDecoding: boolean
  private modelPath: string = ''

  constructor(options?: { onProgress?: (message: string) => void; variant?: string; modelSize?: SLMModelSize; kvCacheQuant?: boolean; speculativeDecoding?: boolean }) {
    this.onProgress = options?.onProgress
    this.modelSize = options?.modelSize ?? '4b'
    this.variant = options?.variant ?? 'Q4_K_M'
    this.kvCacheQuant = options?.kvCacheQuant ?? true
    this.speculativeDecoding = options?.speculativeDecoding ?? false
    this.name = `TranslateGemma ${this.modelSize.toUpperCase()} (Offline)`
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.initialized) return

    // Download model if needed
    const variants = getGGUFVariants(this.modelSize)
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    this.modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    // Resolve draft model path for speculative decoding (4B draft + 12B verifier)
    let draftModelPath: string | undefined
    if (this.speculativeDecoding && this.modelSize === '12b') {
      const draftVariants = getGGUFVariants('4b')
      const draftVariantConfig = draftVariants['Q4_K_M']!
      if (isGGUFDownloaded(draftVariantConfig.filename)) {
        draftModelPath = join(getGGUFDir(), draftVariantConfig.filename)
        this.onProgress?.('Speculative decoding enabled: 4B draft + 12B verifier')
      } else {
        this.onProgress?.('Speculative decoding skipped: 4B draft model not downloaded')
      }
    }

    this.onProgress?.(`Starting TranslateGemma ${this.modelSize.toUpperCase()} worker...`)

    await workerPool.acquire({
      modelPath: this.modelPath,
      kvCacheQuant: this.kvCacheQuant,
      draftModelPath
    }, this.onProgress)

    const specLabel = draftModelPath ? ' (speculative decoding)' : ''
    this.onProgress?.(`TranslateGemma ${this.modelSize.toUpperCase()} model loaded${specLabel}`)
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.initialized) {
      throw new Error('[slm-worker] Not initialized')
    }

    return workerPool.sendRequest(
      { type: 'translate', text, from, to, context },
      'translate'
    )
  }

  async translateIncremental(
    text: string,
    previousOutput: string,
    from: Language,
    to: Language,
    context?: TranslateContext
  ): Promise<string> {
    if (!text.trim()) return previousOutput || ''
    if (from === to) return text
    if (!this.initialized) {
      throw new Error('[slm-worker] Not initialized')
    }

    return workerPool.sendRequest(
      { type: 'translate-incremental', text, previousOutput, from, to, context },
      'translate-incremental'
    )
  }

  async summarize(transcript: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('[slm-worker] Not initialized')
    }

    return workerPool.sendRequest(
      { type: 'summarize', transcript },
      'summarize'
    )
  }

  async dispose(): Promise<void> {
    if (this.initialized) {
      await workerPool.release()
      this.initialized = false
    }
    this.initPromise = null
  }
}
