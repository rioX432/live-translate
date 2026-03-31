import { join } from 'path'
import { getHunyuanMT15Variants, getLFM2Variants, isGGUFDownloaded, getGGUFDir } from '../model-downloader'
import type { WorkerInitOptions } from '../../main/worker-pool'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

/**
 * HY-MT1.5-1.8B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * 1.8B parameter model (~1.1GB Q4_K_M) supporting 36 languages.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 *
 * Optionally supports speculative decoding with LFM2-350M as draft model (#518).
 * LFM2 generates draft tokens at ~200+ tok/s, HY-MT1.5 verifies/corrects them,
 * yielding 1.5-2x throughput improvement over HY-MT1.5 alone.
 */
export class HunyuanMT15Translator extends LlamaWorkerTranslator {
  readonly id = 'hunyuan-mt-15'
  readonly name: string

  private speculativeDecoding: boolean
  private draftModelPath: string | undefined

  constructor(options?: {
    onProgress?: (message: string) => void
    variant?: string
    kvCacheQuant?: boolean
    speculativeDecoding?: boolean
  }) {
    super(options)
    this.speculativeDecoding = options?.speculativeDecoding ?? false
    this.name = this.speculativeDecoding
      ? 'HY-MT1.5-1.8B + LFM2 Speculative (Offline)'
      : 'HY-MT1.5-1.8B (Offline)'
  }

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getHunyuanMT15Variants()
  }

  protected getModelSizeLabel(): string {
    return 'HY-MT1.5-1.8B'
  }

  protected async afterDownload(): Promise<void> {
    if (!this.speculativeDecoding) return

    // Resolve LFM2-350M draft model path for speculative decoding
    const lfm2Variants = getLFM2Variants()
    const draftVariantConfig = lfm2Variants['Q4_K_M']!
    if (isGGUFDownloaded(draftVariantConfig.filename)) {
      this.draftModelPath = join(getGGUFDir(), draftVariantConfig.filename)
      this.onProgress?.('Speculative decoding enabled: LFM2-350M draft + HY-MT1.5-1.8B verifier')
    } else {
      this.onProgress?.('Speculative decoding skipped: LFM2-350M draft model not downloaded')
    }
  }

  protected getExtraInitOptions(): Partial<WorkerInitOptions> {
    return {
      modelType: 'hunyuan-mt-15' as const,
      ...(this.draftModelPath && { draftModelPath: this.draftModelPath })
    }
  }

  protected getLoadedSuffix(): string {
    return this.draftModelPath ? ' (speculative decoding: LFM2 draft)' : ''
  }
}
