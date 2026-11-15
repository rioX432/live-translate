import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, HY_MT2_MODEL } from '../model-downloader'
import { workerPool } from '../../main/worker-pool'
import { createLogger } from '../../main/logger'

const log = createLogger('hy-mt2')

/**
 * Hy-MT2-1.8B (Apache-2.0) through the shared node-llama-cpp worker. The prompt and
 * decoding parameters live in hy-mt2-prompt.ts and are applied inside the worker.
 *
 * Only whole-segment translate() is offered: the incremental, SimulMT and SSBD paths
 * were tuned for HY-MT1.5 and reused the previous output as a draft, which leaked
 * earlier sentences into interim subtitles.
 */
export class HyMT2Translator implements TranslatorEngine {
  readonly id = 'hy-mt2'
  readonly name = 'Hy-MT2-1.8B (Offline)'
  readonly isOffline = true

  private initialized = false
  private initPromise: Promise<void> | null = null
  private readonly onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize().catch((err) => {
        this.initPromise = null
        throw err
      })
    }
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    const modelPath = join(getGGUFDir(), HY_MT2_MODEL.filename)
    await downloadGGUF(HY_MT2_MODEL.filename, HY_MT2_MODEL.url, this.onProgress, HY_MT2_MODEL.sha256)
    this.onProgress?.('Starting Hy-MT2 worker...')
    await workerPool.acquire({ modelPath, modelType: 'hy-mt2' }, this.onProgress)
    this.onProgress?.('Hy-MT2 model loaded')
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.initialized) {
      throw new Error('[hy-mt2] Not initialized')
    }

    const t0 = performance.now()
    const result = await workerPool.sendRequest(
      { type: 'translate', text, from, to, context },
      'translate'
    )
    log.info(`translate ${from}→${to} inputLen=${text.length} outputLen=${result.length} time=${(performance.now() - t0).toFixed(0)}ms`)
    return result
  }

  async dispose(): Promise<void> {
    if (this.initialized) {
      this.initialized = false
      await workerPool.release()
    }
    this.initPromise = null
  }
}
