import { getPLaMoVariants } from '../model-downloader'
import { LlamaWorkerTranslator } from './LlamaWorkerTranslator'
import type { GGUFVariantConfig } from './LlamaWorkerTranslator'

/**
 * PLaMo-2-Translate 10B translator via node-llama-cpp UtilityProcess.
 * Uses the shared worker pool instead of spawning its own process.
 * 10B parameter PFN model (~5.5GB Q4_K_S) for high-quality JA↔EN translation.
 * Adopted by Japan Government AI Project "Gennai".
 * License: PLaMo Community License.
 */
export class PLaMoTranslator extends LlamaWorkerTranslator {
  readonly id = 'plamo'
  readonly name = 'PLaMo-2 10B (Quality)'

  constructor(options?: { onProgress?: (message: string) => void; variant?: string; kvCacheQuant?: boolean }) {
    // PLaMo GGUF doesn't have Q4_K_M — default to Q4_K_S
    super({ ...options, variant: options?.variant ?? 'Q4_K_S' })
  }

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return getPLaMoVariants()
  }

  protected getModelSizeLabel(): string {
    return 'PLaMo-2-Translate 10B'
  }

  protected getExtraInitOptions() {
    return { modelType: 'plamo' as const }
  }
}
