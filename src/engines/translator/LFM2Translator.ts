import { getLFM2Variants } from '../model-downloader'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

/**
 * LFM2-350M-ENJP-MT translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * 350M parameter Liquid AI model (~230MB Q4_K_M) for ultra-fast JA↔EN translation.
 * License: Liquid Foundation Model License 1.0.
 */
export class LFM2Translator extends LlamaWorkerTranslator {
  readonly id = 'lfm2'
  readonly name = 'LFM2-350M (Ultra-fast)'

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getLFM2Variants()
  }

  protected getModelSizeLabel(): string {
    return 'LFM2-350M'
  }

  protected getExtraInitOptions() {
    return { modelType: 'lfm2' as const }
  }
}
