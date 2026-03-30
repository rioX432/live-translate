import { getHunyuanMT15Variants } from '../model-downloader'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

/**
 * HY-MT1.5-1.8B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * 1.8B parameter model (~1.1GB Q4_K_M) supporting 36 languages.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 */
export class HunyuanMT15Translator extends LlamaWorkerTranslator {
  readonly id = 'hunyuan-mt-15'
  readonly name = 'HY-MT1.5-1.8B (Offline)'

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getHunyuanMT15Variants()
  }

  protected getModelSizeLabel(): string {
    return 'HY-MT1.5-1.8B'
  }

  protected getExtraInitOptions() {
    return { modelType: 'hunyuan-mt-15' as const }
  }
}
