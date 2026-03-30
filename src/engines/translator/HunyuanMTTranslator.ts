import { getHunyuanMTVariants } from '../model-downloader'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

/**
 * Hunyuan-MT-7B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * WMT25 winner: 30/31 categories, 33 languages, 15-65% improvement over Google Translate.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 */
export class HunyuanMTTranslator extends LlamaWorkerTranslator {
  readonly id = 'hunyuan-mt'
  readonly name = 'Hunyuan-MT 7B (Offline)'

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getHunyuanMTVariants()
  }

  protected getModelSizeLabel(): string {
    return 'Hunyuan-MT 7B'
  }

  protected getExtraInitOptions() {
    return { modelType: 'hunyuan-mt' as const }
  }
}
