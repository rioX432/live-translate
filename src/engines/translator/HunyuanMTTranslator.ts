import { join } from 'path'
import { getHunyuanMTVariants, getLFM2Variants, isGGUFDownloaded, getGGUFDir } from '../model-downloader'
import type { WorkerInitOptions } from '../../main/worker-pool'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

/**
 * Hunyuan-MT-7B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * WMT25 winner: 30/31 categories, 33 languages, 15-65% improvement over Google Translate.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 *
 * Optionally supports speculative decoding with LFM2-350M as draft model (#693).
 * LFM2 generates draft tokens at ~200+ tok/s, Hunyuan-MT 7B verifies/corrects them,
 * reducing quality-mode latency from ~3.7s to an estimated ~1.2-1.8s.
 */
export class HunyuanMTTranslator extends LlamaWorkerTranslator {
  readonly id = 'hunyuan-mt'
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
      ? 'Hunyuan-MT 7B + LFM2 Speculative (Offline)'
      : 'Hunyuan-MT 7B (Offline)'
  }

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getHunyuanMTVariants()
  }

  protected getModelSizeLabel(): string {
    return 'Hunyuan-MT 7B'
  }

  protected async afterDownload(): Promise<void> {
    if (!this.speculativeDecoding) return

    // Resolve LFM2-350M draft model path for speculative decoding
    const lfm2Variants = getLFM2Variants()
    const draftVariantConfig = lfm2Variants['Q4_K_M']!
    if (isGGUFDownloaded(draftVariantConfig.filename)) {
      this.draftModelPath = join(getGGUFDir(), draftVariantConfig.filename)
      this.onProgress?.('Speculative decoding enabled: LFM2-350M draft + Hunyuan-MT 7B verifier')
    } else {
      this.onProgress?.('Speculative decoding skipped: LFM2-350M draft model not downloaded')
    }
  }

  protected getExtraInitOptions(): Partial<WorkerInitOptions> {
    return {
      modelType: 'hunyuan-mt' as const,
      ...(this.draftModelPath && { draftModelPath: this.draftModelPath })
    }
  }

  protected getLoadedSuffix(): string {
    return this.draftModelPath ? ' (speculative decoding: LFM2 draft)' : ''
  }
}
