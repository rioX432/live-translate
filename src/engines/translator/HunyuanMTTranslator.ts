import { utilityProcess } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getGGUFDir, downloadGGUF, getHunyuanMTVariants } from '../model-downloader'

const TRANSLATE_TIMEOUT_MS = 30_000

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Hunyuan-MT-7B translator via node-llama-cpp UtilityProcess.
 * Uses the same slm-worker.ts as TranslateGemma but with Hunyuan-MT prompt format.
 * WMT25 winner: 30/31 categories, 33 languages, 15-65% improvement over Google Translate.
 * License: Tencent Hunyuan Community License (Apache 2.0 based, commercial OK < 100M MAU).
 */
export class HunyuanMTTranslator implements TranslatorEngine {
  readonly id = 'hunyuan-mt'
  readonly name = 'Hunyuan-MT 7B (Offline)'
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
    const variants = getHunyuanMTVariants()
    const variantConfig = variants[this.variant] ?? variants['Q4_K_M']!
    const modelPath = join(getGGUFDir(), variantConfig.filename)
    await downloadGGUF(variantConfig.filename, variantConfig.url, this.onProgress, variantConfig.sha256)

    // Spawn UtilityProcess (reuses the same slm-worker)
    this.onProgress?.('Starting Hunyuan-MT 7B worker...')
    const workerPath = join(__dirname, 'slm-worker.js')

    this.worker = utilityProcess.fork(workerPath)

    this.worker.on('exit', (code) => {
      console.log(`[hunyuan-mt] Worker exited with code ${code}`)
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
        try { this.worker?.kill() } catch (e) { console.warn('[hunyuan-mt] Failed to kill worker on timeout:', e) }
        this.worker = null
        reject(new Error('Hunyuan-MT initialization timed out'))
      }, 5 * 60_000)

      const initHandler = (msg: any): void => {
        if (!this.worker) return

        if (msg.type === 'ready') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', initHandler)
          this.onProgress?.('Hunyuan-MT 7B model loaded')
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
        modelType: 'hunyuan-mt'
      })
    })

    if (!this.worker) {
      throw new Error('Worker was killed during initialization')
    }

    // Clear any leftover listeners before registering to prevent duplicates
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
        console.error('[hunyuan-mt] Worker error:', msg.message)
      }
    })
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.worker) {
      throw new Error('[hunyuan-mt] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Hunyuan-MT translation timed out'))
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
      throw new Error('[hunyuan-mt] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Hunyuan-MT incremental translation timed out'))
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
