import type { WorkerInitOptions } from '../../../src/main/worker-pool'
import { LlamaWorkerTranslator } from '../../../src/engines/translator/LlamaWorkerTranslator'
import type { GGUFVariantConfig } from '../../../src/engines/translator/LlamaWorkerTranslator'

/**
 * Bench-only Hy-MT2-1.8B translator. It reuses the worker's HY-MT1.5 prompt and
 * sampling (modelType 'hunyuan-mt-15') because the bench may not change the
 * product worker; this measures what a model-file swap alone would give.
 */
export class HyMT2Translator extends LlamaWorkerTranslator {
  readonly id = 'hy-mt2'
  readonly name = 'Hy-MT2-1.8B (bench)'

  protected getVariants(): Record<string, GGUFVariantConfig> {
    return {
      Q4_K_M: {
        filename: 'Hy-MT2-1.8B-Q4_K_M.gguf',
        url: 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf'
      }
    }
  }

  protected getModelSizeLabel(): string {
    return 'Hy-MT2-1.8B'
  }

  protected getExtraInitOptions(): Partial<WorkerInitOptions> {
    return { modelType: 'hunyuan-mt-15' as const }
  }
}
