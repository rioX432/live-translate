import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, getHunyuanMTVariants } from '../model-downloader'
import { workerPool } from '../../main/worker-pool'
import { createLogger } from '../../main/logger'

const log = createLogger('hunyuan-mt')

/**
 * Hunyuan-MT-7B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * WMT25 winner: 30/31 categories, 33 languages, 15-65% improvement over Google Translate.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 */
export class HunyuanMTTranslator implements TranslatorEngine {
  readonly id = 'hunyuan-mt'
  readonly name = 'Hunyuan-MT 7B (Offline)'
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
    const variants = getHunyuanMTVariants()
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    this.modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    this.onProgress?.('Starting Hunyuan-MT 7B worker...')

    await workerPool.acquire({
      modelPath: this.modelPath,
      kvCacheQuant: this.kvCacheQuant,
      modelType: 'hunyuan-mt'
    }, this.onProgress)

    this.onProgress?.('Hunyuan-MT 7B model loaded')
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.initialized) {
      throw new Error('[hunyuan-mt-worker] Not initialized')
    }

    const t0 = performance.now()
    const result = await workerPool.sendRequest(
      { type: 'translate', text, from, to, context },
      'translate'
    )
    const ms = performance.now() - t0
    log.info(`translate ${from}→${to} inputLen=${text.length} outputLen=${result.length} time=${ms.toFixed(0)}ms`)
    return result
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
      throw new Error('[hunyuan-mt-worker] Not initialized')
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
