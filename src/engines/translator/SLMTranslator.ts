import { utilityProcess } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { getModelsDir, downloadGGUF } from '../model-downloader'

const TRANSLATE_TIMEOUT_MS = 30_000
const GGUF_FILENAME = 'translategemma-4b-it-Q4_K_M.gguf'
const GGUF_URL =
  'https://huggingface.co/google/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-Q4_K_M.gguf'

interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SLMTranslator implements TranslatorEngine {
  readonly id = 'slm-translate'
  readonly name = 'TranslateGemma 4B (Offline)'
  readonly isOffline = true

  private worker: Electron.UtilityProcess | null = null
  private pending = new Map<string, PendingRequest>()
  private nextId = 0
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.worker) return

    // Download model if needed
    const modelPath = join(getModelsDir(), GGUF_FILENAME)
    await downloadGGUF(GGUF_FILENAME, GGUF_URL, this.onProgress)

    // Spawn UtilityProcess
    this.onProgress?.('Starting TranslateGemma worker...')
    const workerPath = join(__dirname, 'slm-worker.js')

    this.worker = utilityProcess.fork(workerPath)

    // Set up message handling
    this.worker.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        this.onProgress?.('TranslateGemma model loaded')
        return
      }
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
        console.error('[slm-translator] Worker error:', msg.message)
      }
    })

    this.worker.on('exit', (code) => {
      console.log(`[slm-translator] Worker exited with code ${code}`)
      this.worker = null
      // Reject all pending requests
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Worker process exited'))
        this.pending.delete(id)
      }
    })

    // Send init command and wait for ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('TranslateGemma initialization timed out'))
      }, 5 * 60_000) // 5 minutes for model loading

      const readyHandler = (msg: any): void => {
        if (msg.type === 'ready') {
          clearTimeout(timeout)
          resolve()
        } else if (msg.type === 'error') {
          clearTimeout(timeout)
          reject(new Error(msg.message))
        }
      }

      this.worker!.on('message', readyHandler)
      this.worker!.postMessage({ type: 'init', modelPath })
    })
  }

  async translate(text: string, from: Language, to: Language, _context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (!this.worker) {
      throw new Error('[slm-translator] Not initialized')
    }

    const id = String(this.nextId++)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('TranslateGemma translation timed out'))
      }, TRANSLATE_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ type: 'translate', id, text, from, to })
    })
  }

  async summarize(transcript: string): Promise<string> {
    if (!this.worker) {
      throw new Error('[slm-translator] Not initialized')
    }

    const id = String(this.nextId++)
    const SUMMARIZE_TIMEOUT_MS = 120_000 // 2 minutes for summarization

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Summarization timed out'))
      }, SUMMARIZE_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ type: 'summarize', id, transcript })
    })
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'dispose' })
        // Give worker time to clean up
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
  }
}
