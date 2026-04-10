import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import {
  BRIDGE_STDERR_MAX_LINES,
  BRIDGE_STDERR_WINDOW_MS,
  BRIDGE_MAX_PENDING_REQUESTS
} from './constants'
import { createLogger, type Logger } from '../main/logger'

/**
 * Build a PATH that includes common locations for Python, Homebrew, etc.
 * Packaged Electron apps inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
 * which misses Homebrew, pyenv, and user venvs.
 */
export function getEnrichedPath(): string {
  const base = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'
  const home = homedir()
  const extras = [
    `${home}/.local/bin`,
    `${home}/.pyenv/shims`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${home}/mlx-env/bin`,
    `${home}/.venv/bin`,
  ]
  // Prepend extras that aren't already in PATH
  const missing = extras.filter((p) => !base.split(':').includes(p))
  return [...missing, base].join(':')
}

/**
 * Resolve a Python bridge script path.
 * In dev: resources/ relative to project root (via __dirname).
 * In packaged app: extraResources/bridge-scripts/ via process.resourcesPath.
 */
export function resolveBridgeScript(scriptName: string): string {
  const { app } = require('electron')
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bridge-scripts', scriptName)
  }
  // Dev mode: __dirname = out/main/ → ../../resources/
  return join(__dirname, '../../resources', scriptName)
}

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
  private _log: Logger | null = null
  private initPromise: Promise<void> | null = null
  private pendingRequests = new Map<number, { resolve: (data: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }>()
  private nextRequestId = 0
  private buffer = ''
  private stderrRateLimit = { count: 0, lastReset: Date.now() }

  /** Lazily initialized logger using the subclass log prefix */
  protected get log(): Logger {
    if (!this._log) {
      // Strip brackets from prefix like '[opus-mt]' -> 'opus-mt'
      const prefix = this.getLogPrefix()
      const module = prefix.replace(/^\[|\]$/g, '')
      this._log = createLogger(module)
    }
    return this._log
  }

  /** Called on each parsed status message from the bridge (msg.status). Override to forward progress. */
  protected onStatusMessage(_status: string): void {
    // Default: no-op. Subclasses can override to forward progress updates.
  }

  /** Log prefix used in all console messages, e.g. '[opus-mt]'. */
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

  /**
   * Resolve a python3 command to the project .venv if available,
   * falling back to the system python3.
   */
  protected resolvePython(): string {
    // Resolve symlinks so the path works when launched via Electron.app symlink setup
    const realDir = realpathSync(__dirname)
    const venvPython = join(realDir, '../../.venv/bin/python3')
    this.log.info(`resolvePython: __dirname=${__dirname} realDir=${realDir} venv=${venvPython} exists=${existsSync(venvPython)}`)
    if (existsSync(venvPython)) return venvPython
    return 'python3'
  }

  private async doInitialize(): Promise<void> {
    if (this.process) return

    const initTimeout = this.getInitTimeout()

    let spawnConfig: SpawnConfig
    try {
      spawnConfig = this.getSpawnConfig()
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }

    const timer = setTimeout(() => {
      this.log.error('bridge initialization timed out')
      try {
        this.process?.kill()
      } catch (e) {
        this.log.warn('bridge: failed to kill process on timeout:', e)
      }
      this.process = null
    }, initTimeout)

    try {
      this.process = spawn(spawnConfig.command, spawnConfig.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: getEnrichedPath() }
      })
    } catch {
      clearTimeout(timer)
      throw this.getSpawnError()
    }

    this.process.on('error', (err) => {
      clearTimeout(timer)
      this.log.error('bridge failed to start:', err.message)
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
            const pending = this.pendingRequests.get(reqId)!
            this.pendingRequests.delete(reqId)
            clearTimeout(pending.timer)
            pending.resolve(msg)
          }
        } catch {
          this.log.warn('bridge invalid JSON:', line)
        }
      }
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      const now = Date.now()
      if (now - this.stderrRateLimit.lastReset > BRIDGE_STDERR_WINDOW_MS) {
        this.stderrRateLimit = { count: 0, lastReset: now }
      }
      if (this.stderrRateLimit.count < BRIDGE_STDERR_MAX_LINES) {
        this.stderrRateLimit.count++
        this.log.warn('bridge stderr:', data.toString().trim())
      }
    })

    this.process.on('exit', (code) => {
      this.log.info(`bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command
    try {
      const result = await this.sendCommand(
        spawnConfig.initMessage,
        initTimeout
      )
      if (result.error) {
        throw new Error(`${this.getLogPrefix()} init failed: ${result.error}`)
      }
      this.onInitComplete(result)
    } catch (err) {
      if (this.process) {
        try {
          this.process.kill()
        } catch (e) {
          this.log.warn('bridge: failed to kill process during init cleanup:', e)
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
   * Enforces a max pending request limit — if exceeded, the oldest request
   * is rejected to prevent unbounded memory growth.
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

      // Evict the oldest pending request if at capacity
      if (this.pendingRequests.size >= BRIDGE_MAX_PENDING_REQUESTS) {
        const oldestKey = this.pendingRequests.keys().next().value!
        const oldest = this.pendingRequests.get(oldestKey)!
        this.pendingRequests.delete(oldestKey)
        clearTimeout(oldest.timer)
        oldest.resolve({ error: 'Evicted: pending request limit exceeded' })
      }

      const reqId = this.nextRequestId++ % 0xffffff

      const timeoutMs = timeout ?? this.getCommandTimeout()
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error('Bridge command timed out'))
      }, timeoutMs)

      this.pendingRequests.set(reqId, { resolve: (data) => {
        clearTimeout(timer)
        resolve(data)
      }, timer })

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
    this.log.info('bridge disposing resources')
    if (this.process) {
      try {
        this.sendCommand({ action: 'dispose' }).catch((e) => {
          this.log.warn('bridge: failed to send dispose command:', e)
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (e) {
        this.log.warn('bridge: error during dispose command:', e)
      }
      try {
        this.process.kill()
      } catch (e) {
        this.log.warn('bridge: failed to kill process during dispose:', e)
      }
      this.process = null
    }
    // Snapshot pending requests to avoid concurrent modification
    const pending = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()
    for (const entry of pending) {
      clearTimeout(entry.timer)
      entry.resolve({ error: 'Engine disposed' })
    }
    this.initPromise = null
  }
}
