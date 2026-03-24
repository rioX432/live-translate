import { utilityProcess } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import type { SLMWorkerOutgoingMessage } from './slm-worker-types'
import { getGGUFDir, downloadGGUF, getHunyuanMT15Variants } from '../model-downloader'

const TRANSLATE_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * HY-MT1.5-1.8B translator via node-llama-cpp UtilityProcess.
 * Uses the same slm-worker.ts as Hunyuan-MT 7B but with HY-MT1.5 prompt format.
 * 1.8B parameter model (~1.1GB Q4_K_M) supporting 36 languages.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 */
export class HunyuanMT15Translator implements TranslatorEngine {
  readonly id = 'hunyuan-mt-15'
  readonly name = 'HY-MT1.5-1.8B (Offline)'
  readonly isOffline = true

  private worker: Electron.UtilityProcess | null = null
  private pending = new Map<string, PendingRequest>()
  private nextId = 0
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private variant: string
  private kvCacheQuant: boolean

  constructor(options?: { onProgress?: (message: string) => void; variant?: string; kvCacheQuant?: boolean }) {
    this.onProgress = options?.onProgress
    this.variant = options?.variant ?? 'Q4_K_M'
    this.kvCacheQuant = options?.kvCacheQuant ?? true
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.worker) return

    // Download model if needed
    const variants = getHunyuanMT15Variants()
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    const modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    // Spawn UtilityProcess (reuses the same slm-worker)
    this.onProgress?.('Starting HY-MT1.5-1.8B worker...')
    const workerPath = join(__dirname, 'slm-worker.js')

    this.worker = utilityProcess.fork(workerPath)

    this.worker.on('exit', (code) => {
      console.log(`[hunyuan-mt-15] Worker exited with code ${code}`)
      this.worker = null
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Worker process exited'))
        this.pending.delete(id)
      }
    })

    // Wait for init before registering the general message handler
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.worker?.removeListener('message', initHandler)
        try { this.worker?.kill() } catch (e) { console.warn('[hy-mt1.5] Failed to kill worker on timeout:', e) }
        this.worker = null
        reject(new Error('HY-MT1.5 initialization timed out'))
      }, 5 * 60_000)

      const initHandler = (msg: SLMWorkerOutgoingMessage): void => {
        if (!this.worker) return

        if (msg.type === 'ready') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', initHandler)
          this.onProgress?.('HY-MT1.5-1.8B model loaded')
          resolve()
        } else if (msg.type === 'error') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', initHandler)
          reject(new Error(msg.message))
        }
      }

      this.worker!.on('message', initHandler)
      this.worker!.postMessage({
        type: 'init',
        modelPath,
        kvCacheQuant: this.kvCacheQuant,
        modelType: 'hunyuan-mt-15'
      })
    })

    if (!this.worker) {
      throw new Error('Worker was killed during initialization')
    }

    // Clear any leftover listeners before registering to prevent duplicates
    this.worker.removeAllListeners('message')
    this.worker.on('message', (msg: SLMWorkerOutgoingMessage) => {
      if (msg.type === 'result' && msg.id) {
        const req = this.pending.get(msg.id)
        if (req) {
          clearTimeout(req.timer)
          this.pending.delete(msg.id)
          req.resolve(msg.text)
        }
        return
      }
      if (msg.type === 'error' && msg.id) {
        const req = this.pending.get(msg.id)
        if (req) {
          clearTimeout(req.timer)
          this.pending.delete(msg.id)
          req.reject(new Error(msg.message))
        }
        return
      }
      if (msg.type === 'error') {
        console.error('[hunyuan-mt-15] Worker error:', msg.message)
      }
    })
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.worker) {
      throw new Error('[hunyuan-mt-15] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('HY-MT1.5 translation timed out'))
      }, TRANSLATE_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ type: 'translate', id, text, from, to, context })
    })
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
    if (!this.worker) {
      throw new Error('[hunyuan-mt-15] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('HY-MT1.5 incremental translation timed out'))
      }, TRANSLATE_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({
        type: 'translate-incremental',
        id,
        text,
        previousOutput,
        from,
        to,
        context
      })
    })
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      // Remove all listeners before killing to prevent exit handler from firing
      this.worker.removeAllListeners()
      try {
        this.worker.postMessage({ type: 'dispose' })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch {
        // Ignore errors during disposal
      }
      try {
        this.worker.kill()
      } catch {
        // Already exited
      }
      this.worker = null
    }

    for (const [, req] of this.pending) {
      clearTimeout(req.timer)
      req.reject(new Error('Translator disposed'))
    }
    this.pending.clear()
    this.initPromise = null
  }
}
