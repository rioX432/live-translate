import { join } from 'path'
import { getGGUFDir, getGGUFVariants, isGGUFDownloaded } from '../model-downloader'
import type { SLMModelSize } from '../model-downloader'
import type { WorkerInitOptions } from '../../main/worker-pool'
import { workerPool } from '../../main/worker-pool'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

export class SLMTranslator extends LlamaWorkerTranslator {
  readonly id = 'slm-translate'
  readonly name: string

  private modelSize: SLMModelSize
  private speculativeDecoding: boolean
  private draftModelPath: string | undefined

  constructor(options?: {
    onProgress?: (message: string) => void
    variant?: string
    modelSize?: SLMModelSize
    kvCacheQuant?: boolean
    speculativeDecoding?: boolean
  }) {
    super(options)
    this.modelSize = options?.modelSize ?? '4b'
    this.speculativeDecoding = options?.speculativeDecoding ?? false
    this.name = `TranslateGemma ${this.modelSize.toUpperCase()} (Offline)`
  }

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getGGUFVariants(this.modelSize)
  }

  protected getModelSizeLabel(): string {
    return `TranslateGemma ${this.modelSize.toUpperCase()}`
  }

  protected async afterDownload(): Promise<void> {
    // Resolve draft model path for speculative decoding (4B draft + 12B verifier)
    if (this.speculativeDecoding && this.modelSize === '12b') {
      const draftVariants = getGGUFVariants('4b')
      const draftVariantConfig = draftVariants['Q4_K_M']!
      if (isGGUFDownloaded(draftVariantConfig.filename)) {
        this.draftModelPath = join(getGGUFDir(), draftVariantConfig.filename)
        this.onProgress?.('Speculative decoding enabled: 4B draft + 12B verifier')
      } else {
        this.onProgress?.('Speculative decoding skipped: 4B draft model not downloaded')
      }
    }
  }

  protected getExtraInitOptions(): Partial<WorkerInitOptions> {
    return { draftModelPath: this.draftModelPath }
  }

  protected getLoadedSuffix(): string {
    return this.draftModelPath ? ' (speculative decoding)' : ''
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
}
