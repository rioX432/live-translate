import { spawn, type ChildProcess } from 'child_process'

/**
 * Spawn configuration returned by subclasses to define how the Python bridge
 * process should be launched.
 */
export interface SpawnConfig {
  /** Executable command (e.g. 'python3' or a venv path) */
  command: string
  /** Arguments to pass to the command (typically [bridgePath]) */
  args: string[]
  /** JSON message sent as the first command to initialize the bridge */
  initMessage: Record<string, unknown>
}

/**
 * Result returned by the bridge's init command response.
 * Subclasses interpret the fields in their onInitComplete() hook.
 */
export type InitResult = Record<string, unknown>

/**
 * Abstract base class for engines that communicate with a Python subprocess
 * via JSON-over-stdio. Encapsulates the duplicated bridge lifecycle:
 *
 * - initPromise guard for idempotent initialize()
 * - Python subprocess spawn with stdio config
 * - stdout JSON line parsing and request dispatch
 * - stderr rate limiting (max 10 per 5s window)
 * - Exit handler with pending request cleanup
 * - sendCommand with timeout and reqId
 * - dispose with graceful shutdown
 *
 * Subclasses implement only their engine-specific logic via abstract methods.
 */
export abstract class SubprocessBridge {
  protected process: ChildProcess | null = null
  private initPromise: Promise<void> | null = null
  private pendingRequests = new Map<number, (data: Record<string, unknown>) => void>()
  private nextRequestId = 0
  private buffer = ''
  private stderrRateLimit = { count: 0, lastReset: Date.now() }

  /** Called on each parsed status message from the bridge (msg.status). Override to forward progress. */
  protected onStatusMessage(_status: string): void {
    // Default: no-op. Subclasses can override to forward progress updates.
  }

  /** Log prefix used in all console messages, e.g. '[ct2-opus-mt]'. */
  protected abstract getLogPrefix(): string

  /** Timeout in ms for the init command. */
  protected abstract getInitTimeout(): number

  /** Default timeout in ms for non-init commands. */
  protected abstract getCommandTimeout(): number

  /**
   * Return the spawn configuration for the Python bridge process.
   * Called once during initialization.
   * Throw an Error with a user-friendly message if prerequisites are missing.
   */
  protected abstract getSpawnConfig(): SpawnConfig

  /**
   * Called when the init command returns successfully.
   * Subclasses should validate the result and report readiness via onProgress.
   * Throw an Error to abort initialization.
   */
  protected abstract onInitComplete(result: InitResult): void

  /**
   * Called when the spawn itself fails (e.g. command not found).
   * Return an Error with a user-friendly message describing prerequisites.
   */
  protected abstract getSpawnError(): Error

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.process) return

    const prefix = this.getLogPrefix()
    const initTimeout = this.getInitTimeout()

    let spawnConfig: SpawnConfig
    try {
      spawnConfig = this.getSpawnConfig()
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }

    const timer = setTimeout(() => {
      console.error(`${prefix} Initialization timed out`)
      try {
        this.process?.kill()
      } catch (e) {
        console.warn(`${prefix} Failed to kill process on timeout:`, e)
      }
      this.process = null
    }, initTimeout)

    try {
      this.process = spawn(spawnConfig.command, spawnConfig.args, {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch {
      clearTimeout(timer)
      throw this.getSpawnError()
    }

    this.process.on('error', (err) => {
      clearTimeout(timer)
      console.error(`${prefix} Failed to start Python bridge:`, err.message)
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
            this.onStatusMessage(msg.status)
          }

          const reqId = msg._reqId as number | undefined
          if (reqId !== undefined && this.pendingRequests.has(reqId)) {
            this.pendingRequests.get(reqId)!(msg)
            this.pendingRequests.delete(reqId)
          }
        } catch {
          console.warn(`${prefix} Invalid JSON from bridge:`, line)
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
        console.warn(`${prefix} stderr:`, data.toString().trim())
      }
    })

    this.process.on('exit', (code) => {
      console.log(`${prefix} Bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command
    try {
      const result = await this.sendCommand(
        spawnConfig.initMessage,
        initTimeout
      )
      if (result.error) {
        throw new Error(`${prefix} init failed: ${result.error}`)
      }
      this.onInitComplete(result)
    } catch (err) {
      if (this.process) {
        try {
          this.process.kill()
        } catch (e) {
          console.warn(`${prefix} Failed to kill process during init cleanup:`, e)
        }
        this.process = null
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Send a JSON command to the bridge and wait for a response.
   * @param cmd - The command object (action + data)
   * @param timeout - Optional timeout override in ms
   */
  protected sendCommand(
    cmd: Record<string, unknown>,
    timeout?: number
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Bridge process not running'))
        return
      }

      const reqId = this.nextRequestId++ % 0xffffff

      const timeoutMs = timeout ?? this.getCommandTimeout()
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error('Bridge command timed out'))
      }, timeoutMs)

      this.pendingRequests.set(reqId, (data) => {
        clearTimeout(timer)
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
        clearTimeout(timer)
        reject(new Error(`stdin write error: ${err.message}`))
      })
    })
  }

  async dispose(): Promise<void> {
    const prefix = this.getLogPrefix()
    console.log(`${prefix} Disposing resources`)
    if (this.process) {
      try {
        this.sendCommand({ action: 'dispose' }).catch((e) => {
          console.warn(`${prefix} Failed to send dispose command:`, e)
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (e) {
        console.warn(`${prefix} Error during dispose command:`, e)
      }
      try {
        this.process.kill()
      } catch (e) {
        console.warn(`${prefix} Failed to kill process during dispose:`, e)
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
}
