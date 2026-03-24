import { spawn, type ChildProcess } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { BenchmarkEngine, Direction } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(__dirname, '..', '..', '..', 'resources', 'ct2-madlad400-bridge.py')
const INIT_TIMEOUT_MS = 120_000
const TRANSLATE_TIMEOUT_MS = 30_000

/**
 * CTranslate2-accelerated Madlad-400 benchmark engine.
 * Spawns the same Python bridge script used by the app engine.
 */
export class CT2Madlad400Bench implements BenchmarkEngine {
  readonly id = 'ct2-madlad400'
  readonly label = 'Madlad-400 (CTranslate2)'

  private process: ChildProcess | null = null
  private buffer = ''
  private nextReqId = 0
  private pending = new Map<
    number,
    { resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  async initialize(): Promise<void> {
    if (this.process) return

    console.log('[ct2-madlad400] Starting Python bridge...')
    this.process = spawn('python3', [BRIDGE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.process.on('error', (err) => {
      console.error('[ct2-madlad400] Bridge failed to start:', err.message)
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
          const reqId = msg._reqId as number | undefined
          if (reqId !== undefined && this.pending.has(reqId)) {
            const entry = this.pending.get(reqId)!
            this.pending.delete(reqId)
            clearTimeout(entry.timer)
            entry.resolve(msg)
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) console.warn('[ct2-madlad400] stderr:', text)
    })

    this.process.on('exit', (code) => {
      console.log(`[ct2-madlad400] Bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command
    const result = await this.sendCommand(
      {
        action: 'init',
        model: 'Nextcloud-AI/madlad400-3b-mt-ct2-int8',
        device: 'auto'
      },
      INIT_TIMEOUT_MS
    )

    if (result.error) {
      throw new Error(`[ct2-madlad400] Init failed: ${result.error}`)
    }

    console.log(`[ct2-madlad400] Ready (device: ${result.device ?? 'cpu'})`)
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''
    if (!this.process) {
      throw new Error('[ct2-madlad400] Bridge not running')
    }

    const [, to] = direction.split('-') as [string, string]

    const result = await this.sendCommand(
      { action: 'translate', text, target_lang: to },
      TRANSLATE_TIMEOUT_MS
    )

    if (result.error) {
      throw new Error(`[ct2-madlad400] Translation error: ${result.error}`)
    }

    return (result.translated as string) || ''
  }

  async dispose(): Promise<void> {
    if (this.process) {
      try {
        this.sendCommand({ action: 'dispose' }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch {
        // Ignore
      }
      try {
        this.process.kill()
      } catch {
        // Already exited
      }
      this.process = null
    }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Engine disposed'))
    }
    this.pending.clear()
  }

  private sendCommand(
    cmd: Record<string, unknown>,
    timeout = TRANSLATE_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Bridge process not running'))
        return
      }

      const reqId = this.nextReqId++
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error('Bridge command timed out'))
      }, timeout)

      this.pending.set(reqId, { resolve, reject, timer })
      this.process.stdin.write(JSON.stringify({ ...cmd, _reqId: reqId }) + '\n')
    })
  }
}
