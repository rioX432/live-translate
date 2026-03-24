import { utilityProcess } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, getGemma2JpnVariants } from '../model-downloader'
import {
  WORKER_TRANSLATE_TIMEOUT_MS,
  WORKER_INIT_TIMEOUT_MS,
  WORKER_DISPOSE_GRACE_MS,
  WORKER_MAX_PENDING_REQUESTS
} from '../constants'

/** Messages received from the slm-worker UtilityProcess */
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id?: string; message: string }

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Gemma-2-2B-JPN-IT-Translate via node-llama-cpp UtilityProcess.
 * Uses the same slm-worker.ts as other GGUF-based translators.
 * 2B parameter model (~1.6GB Q4_K_M) specialized for JA↔EN translation.
 * Comparable quality to 7B general-purpose models at half the size.
 * License: Gemma Terms of Use (commercial OK).
 */
export class Gemma2JpnTranslator implements TranslatorEngine {
  readonly id = 'gemma2-jpn'
  readonly name = 'Gemma-2-2B JA↔EN (Offline)'
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
    const variants = getGemma2JpnVariants()
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    const modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    // Spawn UtilityProcess (reuses the same slm-worker)
    this.onProgress?.('Starting Gemma-2-2B JA↔EN worker...')
    const workerPath = join(__dirname, 'slm-worker.js')

    this.worker = utilityProcess.fork(workerPath)

    this.worker.on('exit', (code) => {
      console.log(`[gemma2-jpn-worker] Worker exited with code ${code}`)
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
        try { this.worker?.kill() } catch (e) { console.warn('[gemma2-jpn-worker] Failed to kill worker on timeout:', e) }
        this.worker = null
        reject(new Error('Gemma-2-2B JA↔EN initialization timed out'))
      }, WORKER_INIT_TIMEOUT_MS)

      const initHandler = (msg: WorkerMessage): void => {
        if (!this.worker) return

        if (msg.type === 'ready') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', initHandler)
          this.onProgress?.('Gemma-2-2B JA↔EN model loaded')
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
        modelType: 'gemma2-jpn'
      })
    })

    if (!this.worker) {
      throw new Error('Worker was killed during initialization')
    }

    // Clear any leftover listeners before registering to prevent duplicates
    this.worker.removeAllListeners('message')
    this.worker.on('message', (msg: WorkerMessage) => {
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
        console.error('[gemma2-jpn-worker] Worker error:', msg.message)
      }
    })
  }

  /** Evict the oldest pending request if the map is at capacity */
  private evictOldestPending(): void {
    if (this.pending.size >= WORKER_MAX_PENDING_REQUESTS) {
      const oldestKey = this.pending.keys().next().value!
      const oldest = this.pending.get(oldestKey)!
      this.pending.delete(oldestKey)
      clearTimeout(oldest.timer)
      oldest.reject(new Error('Evicted: worker pending request limit exceeded'))
    }
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.worker) {
      throw new Error('[gemma2-jpn-worker] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      this.evictOldestPending()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Gemma-2-2B JA↔EN translation timed out'))
      }, WORKER_TRANSLATE_TIMEOUT_MS)

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
      throw new Error('[gemma2-jpn-worker] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      this.evictOldestPending()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Gemma-2-2B JA↔EN incremental translation timed out'))
      }, WORKER_TRANSLATE_TIMEOUT_MS)

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
      this.worker.removeAllListeners()
      try {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, WORKER_DISPOSE_GRACE_MS)
          this.worker!.on('message', (msg: any) => {
            if (msg.type === 'disposed') {
              clearTimeout(timeout)
              resolve()
            }
          })
          this.worker!.postMessage({ type: 'dispose' })
        })
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
