import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'

const TRANSLATE_TIMEOUT_MS = 15_000
const INIT_TIMEOUT_MS = 120_000

/**
 * CTranslate2-accelerated OPUS-MT translator (#242).
 *
 * Spawns a Python subprocess running ct2-opus-mt-bridge.py which uses
 * CTranslate2 for 6-10x faster inference compared to ONNX-based OPUS-MT.
 * Model conversion from HuggingFace format to CTranslate2 is handled
 * automatically on first run and cached for subsequent launches.
 *
 * Requirements: pip install ctranslate2 transformers sentencepiece
 */
export class CT2OpusMTTranslator implements TranslatorEngine {
  readonly id = 'ct2-opus-mt'
  readonly name = 'OPUS-MT (CTranslate2 Accelerated)'
  readonly isOffline = true

  private process: ChildProcess | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private pendingRequests = new Map<number, (data: Record<string, unknown>) => void>()
  private nextRequestId = 0
  private buffer = ''
  private stderrRateLimit = { count: 0, lastReset: Date.now() }

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.process) return

    this.onProgress?.('Starting CTranslate2 OPUS-MT bridge...')

    const bridgePath = join(__dirname, '../../resources/ct2-opus-mt-bridge.py')

    const initTimeout = setTimeout(() => {
      console.error('[ct2-opus-mt] Initialization timed out')
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
        'Python 3 not found. Install Python 3 and run: pip install ctranslate2 transformers sentencepiece'
      )
    }

    this.process.on('error', (err) => {
      clearTimeout(initTimeout)
      console.error('[ct2-opus-mt] Failed to start Python bridge:', err.message)
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
          console.warn('[ct2-opus-mt] Invalid JSON from bridge:', line)
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
        console.warn('[ct2-opus-mt] stderr:', data.toString().trim())
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[ct2-opus-mt] Bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command
    try {
      const result = await this.sendCommand({
        action: 'init',
        model_ja_en: 'Helsinki-NLP/opus-mt-ja-en',
        model_en_ja: 'Helsinki-NLP/opus-mt-en-jap',
        device: 'auto',
        quantization: 'int8'
      })
      if (result.error) {
        throw new Error(`CTranslate2 init failed: ${result.error}`)
      }
      this.onProgress?.(
        `CTranslate2 OPUS-MT ready (device: ${result.device ?? 'cpu'}, quantization: ${result.quantization ?? 'int8'})`
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
    _context?: TranslateContext
  ): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.process) {
      console.error(`[ct2-opus-mt] Bridge not running for ${from}->${to}`)
      return ''
    }

    const direction = from === 'ja' ? 'ja-en' : 'en-ja'

    try {
      const result = await this.sendCommand({
        action: 'translate',
        text,
        direction
      })

      if (result.error) {
        console.error('[ct2-opus-mt] Translation error:', result.error)
        return ''
      }

      return (result.translated as string) || ''
    } catch (err) {
      console.error(
        '[ct2-opus-mt] Bridge error:',
        err instanceof Error ? err.message : err
      )
      return ''
    }
  }

  async dispose(): Promise<void> {
    console.log('[ct2-opus-mt] Disposing resources')
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
