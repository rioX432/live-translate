import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'

export interface BridgeMessage {
  [key: string]: unknown
}

/**
 * Manages a Python subprocess bridge for STT engines.
 * Communicates via JSON-over-stdio (same protocol as the resources/*.py bridges).
 */
export class PythonBridge {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<
    string,
    { resolve: (data: BridgeMessage) => void; reject: (err: Error) => void }
  >()
  private requestCounter = 0
  private scriptPath: string
  private pythonBin: string

  constructor(scriptPath: string, pythonBin = 'python3') {
    this.scriptPath = scriptPath
    this.pythonBin = pythonBin
  }

  /** Start the Python subprocess */
  async start(): Promise<void> {
    if (this.process) return

    this.process = spawn(this.pythonBin, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    const rl = createInterface({ input: this.process.stdout! })

    rl.on('line', (line) => {
      try {
        const data = JSON.parse(line) as BridgeMessage
        const reqId = data._reqId as string | undefined
        if (reqId && this.pendingRequests.has(reqId)) {
          const pending = this.pendingRequests.get(reqId)!
          this.pendingRequests.delete(reqId)
          if (data.error) {
            pending.reject(new Error(String(data.error)))
          } else {
            pending.resolve(data)
          }
        }
      } catch {
        // Ignore non-JSON lines (e.g. status messages from stderr)
      }
    })

    // Collect stderr for diagnostics
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (msg) {
        console.error(`[bridge:stderr] ${msg}`)
      }
    })

    this.process.on('error', (err) => {
      console.error(`[bridge] Process error: ${err.message}`)
      this.rejectAllPending(err)
    })

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[bridge] Process exited with code ${code}`)
      }
      this.rejectAllPending(new Error(`Bridge process exited with code ${code}`))
      this.process = null
    })
  }

  /** Send a message and wait for a response */
  async send(message: BridgeMessage, timeoutMs = 120_000): Promise<BridgeMessage> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Bridge process not running')
    }

    const reqId = `req-${++this.requestCounter}`
    const tagged = { ...message, _reqId: reqId }

    return new Promise<BridgeMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error(`Bridge request timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(reqId, {
        resolve: (data) => {
          clearTimeout(timer)
          resolve(data)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })

      this.process!.stdin!.write(JSON.stringify(tagged) + '\n')
    })
  }

  /** Stop the Python subprocess gracefully */
  async stop(): Promise<void> {
    if (!this.process) return

    try {
      await this.send({ action: 'dispose' }, 5_000).catch(() => {
        // Ignore dispose errors
      })
    } finally {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM')
        // Give it a moment to exit gracefully
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL')
            }
            resolve()
          }, 3_000)
          this.process!.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
      this.process = null
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(err)
    }
    this.pendingRequests.clear()
  }
}
