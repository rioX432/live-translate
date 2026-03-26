import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, getHunyuanMT15Variants } from '../model-downloader'
import { workerPool } from '../../main/worker-pool'

/**
 * HY-MT1.5-1.8B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * 1.8B parameter model (~1.1GB Q4_K_M) supporting 36 languages.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 */
export class HunyuanMT15Translator implements TranslatorEngine {
  readonly id = 'hunyuan-mt-15'
  readonly name = 'HY-MT1.5-1.8B (Offline)'
  readonly isOffline = true

  private initialized = false
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private variant: string
  private kvCacheQuant: boolean
  private modelPath: string = ''

  constructor(options?: { onProgress?: (message: string) => void; variant?: string; kvCacheQuant?: boolean }) {
    this.onProgress = options?.onProgress
    this.variant = options?.variant ?? 'Q4_K_M'
    this.kvCacheQuant = options?.kvCacheQuant ?? true
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.initialized) return

    // Download model if needed
    const variants = getHunyuanMT15Variants()
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    this.modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    this.onProgress?.('Starting HY-MT1.5-1.8B worker...')

    await workerPool.acquire({
      modelPath: this.modelPath,
      kvCacheQuant: this.kvCacheQuant,
      modelType: 'hunyuan-mt-15'
    }, this.onProgress)

    this.onProgress?.('HY-MT1.5-1.8B model loaded')
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.initialized) {
      throw new Error('[hunyuan-mt-15-worker] Not initialized')
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
      throw new Error('[hunyuan-mt-15-worker] Not initialized')
    }

    return workerPool.sendRequest(
      { type: 'translate-incremental', text, previousOutput, from, to, context },
      'translate-incremental'
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
