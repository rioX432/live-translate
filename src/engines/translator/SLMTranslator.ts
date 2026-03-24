import { utilityProcess } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, getGGUFVariants, isGGUFDownloaded } from '../model-downloader'
import type { SLMModelSize } from '../model-downloader'
import {
  WORKER_TRANSLATE_TIMEOUT_MS,
  WORKER_SUMMARIZE_TIMEOUT_MS,
  WORKER_INIT_TIMEOUT_MS,
  WORKER_DISPOSE_GRACE_MS,
  WORKER_MAX_PENDING_REQUESTS
} from '../constants'

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SLMTranslator implements TranslatorEngine {
  readonly id = 'slm-translate'
  readonly name: string
  readonly isOffline = true

  private worker: Electron.UtilityProcess | null = null
  private pending = new Map<string, PendingRequest>()
  private nextId = 0
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private variant: string
  private modelSize: SLMModelSize
  private kvCacheQuant: boolean
  private speculativeDecoding: boolean

  constructor(options?: { onProgress?: (message: string) => void; variant?: string; modelSize?: SLMModelSize; kvCacheQuant?: boolean; speculativeDecoding?: boolean }) {
    this.onProgress = options?.onProgress
    this.modelSize = options?.modelSize ?? '4b'
    this.variant = options?.variant ?? 'Q4_K_M'
    this.kvCacheQuant = options?.kvCacheQuant ?? true
    this.speculativeDecoding = options?.speculativeDecoding ?? false
    this.name = `TranslateGemma ${this.modelSize.toUpperCase()} (Offline)`
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.worker) return

    // Download model if needed
    const variants = getGGUFVariants(this.modelSize)
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    const modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    // Resolve draft model path for speculative decoding (4B draft + 12B verifier)
    let draftModelPath: string | undefined
    if (this.speculativeDecoding && this.modelSize === '12b') {
      const draftVariants = getGGUFVariants('4b')
      const draftVariantConfig = draftVariants['Q4_K_M']!
      if (isGGUFDownloaded(draftVariantConfig.filename)) {
        draftModelPath = join(getGGUFDir(), draftVariantConfig.filename)
        this.onProgress?.('Speculative decoding enabled: 4B draft + 12B verifier')
      } else {
        this.onProgress?.('Speculative decoding skipped: 4B draft model not downloaded')
      }
    }

    // Spawn UtilityProcess
    this.onProgress?.(`Starting TranslateGemma ${this.modelSize.toUpperCase()} worker...`)
    const workerPath = join(__dirname, 'slm-worker.js')

    this.worker = utilityProcess.fork(workerPath)

    this.worker.on('exit', (code) => {
      console.log(`[slm-worker] Worker exited with code ${code}`)
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
        // Kill orphaned worker on timeout
        try { this.worker?.kill() } catch (e) { console.warn('[slm-worker] Failed to kill worker on timeout:', e) }
        this.worker = null
        reject(new Error('TranslateGemma initialization timed out'))
      }, WORKER_INIT_TIMEOUT_MS)

      const initHandler = (msg: any): void => {
        // Guard: ignore messages if worker was killed during timeout (#205)
        if (!this.worker) return

        if (msg.type === 'ready') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', initHandler)
          const specLabel = draftModelPath ? ' (speculative decoding)' : ''
          this.onProgress?.(`TranslateGemma ${this.modelSize.toUpperCase()} model loaded${specLabel}`)
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
        ...(draftModelPath && { draftModelPath })
      })
    })

    // Guard: worker may have been killed during init timeout (#205)
    if (!this.worker) {
      throw new Error('Worker was killed during initialization')
    }

    // Clear any leftover listeners before registering to prevent duplicates (#206)
    this.worker.removeAllListeners('message')
    this.worker.on('message', (msg: any) => {
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
        console.error('[slm-worker] Worker error:', msg.message)
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
      throw new Error('[slm-worker] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      this.evictOldestPending()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('TranslateGemma translation timed out'))
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
      throw new Error('[slm-worker] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      this.evictOldestPending()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('TranslateGemma incremental translation timed out'))
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

  async summarize(transcript: string): Promise<string> {
    if (!this.worker) {
      throw new Error('[slm-worker] Not initialized')
    }

    const id = String(this.nextId++)
    return new Promise<string>((resolve, reject) => {
      this.evictOldestPending()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Summarization timed out'))
      }, WORKER_SUMMARIZE_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ type: 'summarize', id, transcript })
    })
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      // Remove all listeners before sending dispose to prevent exit handler from firing
      this.worker.removeAllListeners()
      try {
        // Wait for the worker to confirm disposal or fall back to timeout
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
