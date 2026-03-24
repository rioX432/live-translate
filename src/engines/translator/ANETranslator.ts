import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'

const TRANSLATE_TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 600_000 // 10 min — first-run CoreML conversion can be slow

/**
 * ANEMLL Apple Neural Engine translator (#241).
 *
 * Spawns a Python subprocess running ane-translate-bridge.py which uses
 * ANEMLL to convert models to CoreML and run inference on the Apple Neural
 * Engine (ANE). ANE provides ~1/10 power consumption vs GPU and ~1/16
 * memory usage, ideal for battery-powered laptops.
 *
 * macOS with Apple Silicon only.
 *
 * Requirements: pip install anemll coremltools transformers pyyaml numpy torch
 */
export class ANETranslator implements TranslatorEngine {
  readonly id = 'ane-translate'
  readonly name = 'ANEMLL (Apple Neural Engine)'
  readonly isOffline = true

  private process: ChildProcess | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private model: string
  private pendingRequests = new Map<number, (data: Record<string, unknown>) => void>()
  private nextRequestId = 0
  private buffer = ''
  private stderrRateLimit = { count: 0, lastReset: Date.now() }

  constructor(options?: {
    model?: string
    onProgress?: (message: string) => void
  }) {
    this.model = options?.model ?? 'google/gemma-3-4b-it'
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.process) return

    this.onProgress?.('Starting ANEMLL bridge...')

    const bridgePath = join(__dirname, '../../resources/ane-translate-bridge.py')

    const initTimeout = setTimeout(() => {
      console.error('[ane-translate] Initialization timed out')
      try {
        this.process?.kill()
      } catch {
        /* ignore */
      }
      this.process = null
    }, INIT_TIMEOUT_MS)

    try {
      this.process = spawn('python3', [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      clearTimeout(initTimeout)
      throw new Error(
        'Python 3 not found. Install Python 3 and run: pip install anemll coremltools transformers pyyaml numpy torch'
      )
    }

    this.process.on('error', (err) => {
      clearTimeout(initTimeout)
      console.error('[ane-translate] Failed to start Python bridge:', err.message)
      this.process = null
    })

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)

          // Forward status messages as progress updates
          if (msg.status && typeof msg.status === 'string') {
            this.onProgress?.(msg.status)
          }

          const reqId = msg._reqId as number | undefined
          if (reqId !== undefined && this.pendingRequests.has(reqId)) {
            this.pendingRequests.get(reqId)!(msg)
            this.pendingRequests.delete(reqId)
          }
        } catch {
          console.warn('[ane-translate] Invalid JSON from bridge:', line)
        }
      }
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      const now = Date.now()
      if (now - this.stderrRateLimit.lastReset > 5000) {
        this.stderrRateLimit = { count: 0, lastReset: now }
      }
      if (this.stderrRateLimit.count < 10) {
        this.stderrRateLimit.count++
        console.warn('[ane-translate] stderr:', data.toString().trim())
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[ane-translate] Bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command
    try {
      const result = await this.sendCommand({
        action: 'init',
        model: this.model,
        context_length: 512
      })
      if (result.error) {
        throw new Error(`ANEMLL init failed: ${result.error}`)
      }
      this.onProgress?.(
        `ANEMLL ready (ANE, context: ${result.context_length ?? 512}, monolithic: ${result.monolithic ?? false})`
      )
    } catch (err) {
      if (this.process) {
        try {
          this.process.kill()
        } catch {
          /* ignore */
        }
        this.process = null
      }
      throw err
    } finally {
      clearTimeout(initTimeout)
    }
  }

  async translate(
    text: string,
    from: Language,
    to: Language,
    context?: TranslateContext
  ): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.process) {
      console.error(`[ane-translate] Bridge not running for ${from}->${to}`)
      return ''
    }

    try {
      const result = await this.sendCommand({
        action: 'translate',
        text,
        from,
        to,
        context: context
          ? {
              previousSegments: context.previousSegments?.slice(-3),
              glossary: context.glossary
            }
          : undefined
      })

      if (result.error) {
        console.error('[ane-translate] Translation error:', result.error)
        return ''
      }

      return (result.translated as string) || ''
    } catch (err) {
      console.error(
        '[ane-translate] Bridge error:',
        err instanceof Error ? err.message : err
      )
      return ''
    }
  }

  async dispose(): Promise<void> {
    console.log('[ane-translate] Disposing resources')
    if (this.process) {
      try {
        this.sendCommand({ action: 'dispose' }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch {
        /* ignore */
      }
      try {
        this.process.kill()
      } catch {
        /* ignore */
      }
      this.process = null
    }
    // Snapshot pending requests to avoid concurrent modification
    const pending = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()
    for (const resolve of pending) {
      resolve({ error: 'Engine disposed' })
    }
    this.initPromise = null
  }

  private sendCommand(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Bridge process not running'))
        return
      }

      const reqId = this.nextRequestId++ % 0xffffff

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error('Bridge command timed out'))
      }, cmd.action === 'init' ? INIT_TIMEOUT_MS : TRANSLATE_TIMEOUT_MS)

      this.pendingRequests.set(reqId, (data) => {
        clearTimeout(timeout)
        resolve(data)
      })

      const written = this.process.stdin.write(
        JSON.stringify({ ...cmd, _reqId: reqId }) + '\n'
      )
      if (!written) {
        this.process.stdin.once('drain', () => {
          /* backpressure resolved */
        })
      }
      this.process.stdin.once('error', (err) => {
        this.pendingRequests.delete(reqId)
        clearTimeout(timeout)
        reject(new Error(`stdin write error: ${err.message}`))
      })
    })
  }
}
