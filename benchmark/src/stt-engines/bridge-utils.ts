import { spawn, type ChildProcess } from 'child_process'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

/** Default timeout for bridge init (120s for model download) */
export const BRIDGE_INIT_TIMEOUT_MS = 120_000
/** Default timeout for transcription (30s) */
export const BRIDGE_TRANSCRIBE_TIMEOUT_MS = 30_000

/**
 * Lightweight subprocess bridge for benchmark engines.
 * Communicates with Python bridges via JSON-over-stdio.
 * This is a standalone implementation (not dependent on Electron SubprocessBridge).
 */
export class BenchmarkBridge {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<
    number,
    { resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private nextRequestId = 0
  private buffer = ''
  private logPrefix: string

  constructor(logPrefix: string) {
    this.logPrefix = logPrefix
  }

  get isRunning(): boolean {
    return this.process !== null
  }

  /**
   * Spawn the bridge process and send an init command.
   */
  async start(
    command: string,
    args: string[],
    initMessage: Record<string, unknown>,
    initTimeout = BRIDGE_INIT_TIMEOUT_MS
  ): Promise<void> {
    if (this.process) return

    this.process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          const reqId = msg._reqId as number | undefined
          if (reqId !== undefined && this.pendingRequests.has(reqId)) {
            const pending = this.pendingRequests.get(reqId)!
            this.pendingRequests.delete(reqId)
            clearTimeout(pending.timer)
            pending.resolve(msg)
          }
        } catch {
          // Ignore non-JSON output (e.g. model download progress)
        }
      }
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        console.warn(`${this.logPrefix} stderr:`, text.slice(0, 200))
      }
    })

    this.process.on('exit', (code) => {
      console.log(`${this.logPrefix} process exited with code ${code}`)
      this.process = null
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Bridge process exited'))
      }
      this.pendingRequests.clear()
    })

    // Send init command
    const result = await this.sendCommand(initMessage, initTimeout)
    if (result.error) {
      await this.stop()
      throw new Error(`${this.logPrefix} init failed: ${result.error}`)
    }
  }

  /**
   * Send a JSON command and wait for a response.
   */
  sendCommand(
    cmd: Record<string, unknown>,
    timeout = BRIDGE_TRANSCRIBE_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Bridge process not running'))
        return
      }

      const reqId = this.nextRequestId++ % 0xffffff
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error('Bridge command timed out'))
      }, timeout)

      this.pendingRequests.set(reqId, { resolve, reject, timer })

      this.process.stdin.write(JSON.stringify({ ...cmd, _reqId: reqId }) + '\n')
    })
  }

  /**
   * Gracefully stop the bridge process.
   */
  async stop(): Promise<void> {
    if (!this.process) return

    try {
      this.process.stdin?.write(JSON.stringify({ action: 'dispose' }) + '\n')
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch {
      // Ignore write errors during shutdown
    }

    try {
      this.process.kill()
    } catch {
      // Already dead
    }

    this.process = null

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Bridge disposed'))
    }
    this.pendingRequests.clear()
  }
}

/**
 * Find a Python 3 executable that has a specific module installed.
 * Searches common venv locations, then falls back to system python3.
 */
export function findPython3WithModule(moduleName: string, extraVenvDirs: string[] = []): string {
  const venvPaths = [
    ...extraVenvDirs.map((d) => join(homedir(), d, 'bin', 'python3')),
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import ${moduleName}"`, { stdio: 'ignore', timeout: 5000 })
      return p
    } catch {
      // Module not installed in this venv
    }
  }

  // Fall back to system python3
  try {
    execSync(`python3 -c "import ${moduleName}"`, { stdio: 'ignore', timeout: 5000 })
    return 'python3'
  } catch {
    // Not available
  }

  throw new Error(`Python 3 with ${moduleName} not found`)
}

/** Get the path to a resource bridge script */
export function getBridgePath(scriptName: string): string {
  // In benchmark context, resources are at the project root
  return join(getProjectRoot(), 'resources', scriptName)
}

/** Get the project root directory */
export function getProjectRoot(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  return join(dir, '..', '..')
}
