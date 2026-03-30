import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF } from '../model-downloader'
import type { WorkerInitOptions } from '../../main/worker-pool'
import { workerPool } from '../../main/worker-pool'
import { createLogger } from '../../main/logger'

export interface GGUFVariantConfig {
  filename: string
  url: string
  sha256?: string
}

/**
 * Abstract base class for LLM-based translator engines that run via
 * the shared node-llama-cpp UtilityProcess worker pool.
 *
 * Subclasses provide model-specific configuration via template methods;
 * the lifecycle (initialize → download → acquire worker → translate → dispose)
 * is handled entirely by this base class.
 */
export abstract class LlamaWorkerTranslator implements TranslatorEngine {
  abstract readonly id: string
  abstract readonly name: string
  readonly isOffline = true

  protected initialized = false
  private initPromise: Promise<void> | null = null
  protected onProgress?: (message: string) => void
  protected variant: string
  protected kvCacheQuant: boolean
  protected modelPath: string = ''
  private _log: ReturnType<typeof createLogger> | null = null

  constructor(options?: { onProgress?: (message: string) => void; variant?: string; kvCacheQuant?: boolean }) {
    this.onProgress = options?.onProgress
    this.variant = options?.variant ?? 'Q4_K_M'
    this.kvCacheQuant = options?.kvCacheQuant ?? true
  }

  private get log(): ReturnType<typeof createLogger> {
    if (!this._log) this._log = createLogger(this.id)
    return this._log
  }

  // ── Template methods (override in subclasses) ──────────────────────

  /** Return the GGUF variant config map for the current model */
  protected abstract getVariants(): Record<string, GGUFVariantConfig>

  /** Human-readable label shown in progress messages (e.g. "Hunyuan-MT 7B") */
  protected abstract getModelSizeLabel(): string

  /** Extra WorkerInitOptions fields (e.g. modelType, draftModelPath) */
  protected getExtraInitOptions(): Partial<WorkerInitOptions> {
    return {}
  }

  /**
   * Hook called after model download but before worker acquire.
   * Subclasses can use this to prepare additional resources (e.g. draft models).
   */
  protected async afterDownload(): Promise<void> {
    // no-op by default
  }

  /** Hook called after worker reports model loaded */
  protected getLoadedSuffix(): string {
    return ''
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.initialized) return

    // Download model if needed
    const variants = this.getVariants()
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    this.modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    await this.afterDownload()

    const label = this.getModelSizeLabel()
    this.onProgress?.(`Starting ${label} worker...`)

    await workerPool.acquire({
      modelPath: this.modelPath,
      kvCacheQuant: this.kvCacheQuant,
      ...this.getExtraInitOptions()
    }, this.onProgress)

    const suffix = this.getLoadedSuffix()
    this.onProgress?.(`${label} model loaded${suffix}`)
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.initialized) {
      throw new Error(`[${this.id}-worker] Not initialized`)
    }

    const t0 = performance.now()
    const result = await workerPool.sendRequest(
      { type: 'translate', text, from, to, context },
      'translate'
    )
    const ms = performance.now() - t0
    this.log.info(`translate ${from}→${to} inputLen=${text.length} outputLen=${result.length} time=${ms.toFixed(0)}ms`)
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
      throw new Error(`[${this.id}-worker] Not initialized`)
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
