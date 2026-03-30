/**
 * Shared UtilityProcess pool for slm-worker.
 *
 * Ensures only ONE slm-worker UtilityProcess runs at a time.
 * Multiple engines (SLMTranslator, HunyuanMTTranslator, HunyuanMT15Translator)
 * and the generate-summary handler all share this single worker.
 *
 * When a different model is needed, the pool sends a dispose+init sequence
 * to hot-swap the loaded model without killing the process.
 */

import { utilityProcess } from 'electron'
import { join } from 'path'
import {
  WORKER_INIT_TIMEOUT_MS,
  WORKER_DISPOSE_GRACE_MS,
  WORKER_MAX_PENDING_REQUESTS,
  WORKER_TRANSLATE_TIMEOUT_MS,
  WORKER_SUMMARIZE_TIMEOUT_MS
} from '../engines/constants'
import { createLogger } from './logger'

const log = createLogger('worker-pool')

/** Messages received from the slm-worker UtilityProcess */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id?: string; message: string }
  | { type: 'disposed' }

export interface PendingRequest {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface WorkerInitOptions {
  modelPath: string
  kvCacheQuant?: boolean
  modelType?: string
  draftModelPath?: string
}

/** Timeout value by request type */
export type RequestType = 'translate' | 'translate-incremental' | 'summarize' | 'ger-correct'

const TIMEOUT_BY_TYPE: Record<RequestType, number> = {
  'translate': WORKER_TRANSLATE_TIMEOUT_MS,
  'translate-incremental': WORKER_TRANSLATE_TIMEOUT_MS,
  'summarize': WORKER_SUMMARIZE_TIMEOUT_MS,
  'ger-correct': WORKER_TRANSLATE_TIMEOUT_MS
}

/**
 * Singleton pool managing a single slm-worker UtilityProcess.
 * Reference-counted: the process stays alive while any engine holds a reference.
 */
class WorkerPool {
  private worker: Electron.UtilityProcess | null = null
  private pending = new Map<string, PendingRequest>()
  private nextId = 0
  private refCount = 0
  private currentModelPath: string | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  /** Mutex to serialize initModel/disposeModel operations */
  private opLock: Promise<void> = Promise.resolve()

  /**
   * Acquire a reference to the shared worker, initializing it with the given model.
   * If the worker is already running with a different model, it will hot-swap.
   */
  async acquire(options: WorkerInitOptions, onProgress?: (message: string) => void): Promise<void> {
    this.refCount++
    this.onProgress = onProgress

    // If worker exists and same model is loaded, skip init
    if (this.worker && this.currentModelPath === options.modelPath) {
      return
    }

    // If worker exists but different model, hot-swap via dispose+init
    if (this.worker && this.currentModelPath !== options.modelPath) {
      await this.hotSwapModel(options)
      return
    }

    // No worker yet — spawn and init
    if (!this.initPromise || !this.worker) {
      this.initPromise = this.spawnAndInit(options)
    }
    return this.initPromise
  }

  /**
   * Release a reference. When refCount reaches 0, the worker is killed.
   */
  async release(): Promise<void> {
    this.refCount = Math.max(0, this.refCount - 1)

    if (this.refCount === 0) {
      await this.killWorker()
    }
  }

  /**
   * Send a message to the worker and return a promise for the result.
   */
  sendRequest(message: Record<string, unknown>, type: RequestType): Promise<string> {
    if (!this.worker) {
      return Promise.reject(new Error('[worker-pool] Worker not initialized'))
    }

    const id = String(this.nextId++)
    const timeout = TIMEOUT_BY_TYPE[type]
    const sendTime = performance.now()

    return new Promise<string>((resolve, reject) => {
      this.evictOldestPending()

      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker request timed out (${type})`))
      }, timeout)

      this.pending.set(id, {
        resolve: (value: string) => {
          const roundTripMs = performance.now() - sendTime
          if (roundTripMs > 2000) {
            log.info(`Request ${id} round-trip: ${roundTripMs.toFixed(0)}ms (${type})`)
          }
          resolve(value)
        },
        reject,
        timer
      })
      this.worker!.postMessage({ ...message, id })
    })
  }

  /** Check if the worker is alive and initialized */
  get isAlive(): boolean {
    return this.worker !== null
  }

  /** The model currently loaded in the worker */
  get loadedModelPath(): string | null {
    return this.currentModelPath
  }

  /** Current number of active references */
  get references(): number {
    return this.refCount
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async spawnAndInit(options: WorkerInitOptions): Promise<void> {
    const workerPath = join(__dirname, 'slm-worker.js')
    this.worker = utilityProcess.fork(workerPath)

    this.worker.on('exit', (code) => {
      log.info(`Worker exited with code ${code}`)
      this.worker = null
      this.currentModelPath = null
      this.initPromise = null
      // Reject all pending requests
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Worker process exited'))
        this.pending.delete(id)
      }
    })

    await this.initModel(options)
    this.registerMessageHandler()
  }

  private async hotSwapModel(options: WorkerInitOptions): Promise<void> {
    // Send dispose to unload current model (but keep process alive)
    await this.disposeModel()
    // Re-init with new model
    await this.initModel(options)
    // Re-register the persistent message handler (initModel clears all listeners)
    this.registerMessageHandler()
  }

  private initModel(options: WorkerInitOptions): Promise<void> {
    const op = this.opLock.then(
      () =>
        new Promise<void>((resolve, reject) => {
          let settled = false

          const cleanup = (): void => {
            this.worker?.removeListener('message', initHandler)
          }

          const timeout = setTimeout(() => {
            if (settled) return
            settled = true
            cleanup()
            reject(new Error('Worker initialization timed out'))
          }, WORKER_INIT_TIMEOUT_MS)

          const initHandler = (msg: WorkerMessage): void => {
            if (settled || !this.worker) return

            if (msg.type === 'ready') {
              settled = true
              clearTimeout(timeout)
              cleanup()
              this.currentModelPath = options.modelPath
              resolve()
            } else if (msg.type === 'error') {
              settled = true
              clearTimeout(timeout)
              cleanup()
              reject(new Error(msg.message))
            }
          }

          // Remove stale one-off listeners before attaching new handler
          this.worker?.removeAllListeners('message')
          this.worker!.on('message', initHandler)
          this.worker!.postMessage({
            type: 'init',
            modelPath: options.modelPath,
            kvCacheQuant: options.kvCacheQuant,
            modelType: options.modelType,
            ...(options.draftModelPath && { draftModelPath: options.draftModelPath })
          })
        })
    )
    // Chain the lock so subsequent ops wait, but don't propagate rejections to the chain
    this.opLock = op.catch(() => {})
    return op
  }

  private disposeModel(): Promise<void> {
    const op = this.opLock.then(
      () =>
        new Promise<void>((resolve) => {
          if (!this.worker) {
            resolve()
            return
          }

          let settled = false

          const cleanup = (): void => {
            this.worker?.removeListener('message', disposeHandler)
          }

          const timeout = setTimeout(() => {
            if (settled) return
            settled = true
            cleanup()
            resolve()
          }, WORKER_DISPOSE_GRACE_MS)

          const disposeHandler = (msg: WorkerMessage): void => {
            if (settled) return
            if (msg.type === 'disposed') {
              settled = true
              clearTimeout(timeout)
              cleanup()
              this.currentModelPath = null
              resolve()
            }
          }

          // Remove stale one-off listeners before attaching new handler
          this.worker.removeAllListeners('message')
          this.worker.on('message', disposeHandler)
          this.worker.postMessage({ type: 'dispose' })
        })
    )
    // Chain the lock so subsequent ops wait
    this.opLock = op.catch(() => {})
    return op
  }

  private registerMessageHandler(): void {
    if (!this.worker) return

    // Clear leftover listeners to prevent duplicates
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
        log.error('Worker error:', msg.message)
      }
    })
  }

  private async killWorker(): Promise<void> {
    if (!this.worker) return

    this.worker.removeAllListeners()

    try {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, WORKER_DISPOSE_GRACE_MS)
        this.worker!.once('message', (msg: WorkerMessage) => {
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
    this.currentModelPath = null
    this.initPromise = null

    // Reject all pending requests
    for (const [, req] of this.pending) {
      clearTimeout(req.timer)
      req.reject(new Error('Worker pool disposed'))
    }
    this.pending.clear()
  }

  private evictOldestPending(): void {
    if (this.pending.size >= WORKER_MAX_PENDING_REQUESTS) {
      const oldestKey = this.pending.keys().next().value!
      const oldest = this.pending.get(oldestKey)!
      this.pending.delete(oldestKey)
      clearTimeout(oldest.timer)
      log.warn(
        `Evicting oldest pending request ${oldestKey} — queue full (${WORKER_MAX_PENDING_REQUESTS})`
      )
      oldest.reject(
        new Error(
          `Evicted: pending request limit exceeded (max ${WORKER_MAX_PENDING_REQUESTS})`
        )
      )
    }
  }
}

/** Singleton shared worker pool */
export const workerPool = new WorkerPool()
