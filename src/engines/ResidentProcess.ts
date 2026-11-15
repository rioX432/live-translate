import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createLogger, type Logger } from '../main/logger'

export type ResidentProcessState = 'stopped' | 'starting' | 'ready' | 'failed' | 'disposed'

export type SpawnFn = (command: string, args: string[]) => ChildProcessWithoutNullStreams

export interface ResidentProcessOptions {
  command: string
  args: string[]
  /** Logger module name */
  name: string
  /** Time allowed from spawn to the `{"ready":true}` line */
  readyTimeoutMs: number
  /** Time allowed for one reply, counted from when the request is written */
  requestTimeoutMs: number
  /** Consecutive crashes or failed starts tolerated before the process is marked failed */
  maxRestarts: number
  /** Grace period between closing stdin and SIGKILL on dispose */
  disposeGraceMs?: number
  spawnFn?: SpawnFn
}

interface PendingRequest {
  resolve: (reply: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const defaultSpawn: SpawnFn = (command, args) => spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })

/**
 * Keeps one helper process alive and talks to it with one JSON object per line.
 *
 * Protocol: the child prints `{"ready":true}` once it can serve, or `{"fatal":"..."}`
 * and exits. Each request carries a numeric `id` that the reply echoes.
 *
 * A crash rejects the requests in flight and starts the child again in the background,
 * so the next segment does not also pay the model load. After `maxRestarts` consecutive
 * crashes or failed starts the process stays down and every request throws, which lets
 * the pipeline surface the error instead of hiding it as silence. A successful reply
 * resets the count.
 */
export class ResidentProcess {
  private readonly options: ResidentProcessOptions
  private readonly spawnFn: SpawnFn
  private readonly log: Logger
  private child: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<void> | null = null
  private _state: ResidentProcessState = 'stopped'
  private consecutiveFailures = 0
  private lastError: Error | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(options: ResidentProcessOptions) {
    this.options = options
    this.spawnFn = options.spawnFn ?? defaultSpawn
    this.log = createLogger(options.name)
  }

  get state(): ResidentProcessState {
    return this._state
  }

  /** Start the child if it is not running. Resolves once it reported ready. */
  start(): Promise<void> {
    if (this._state === 'disposed') return Promise.reject(new Error(`${this.options.name} disposed`))
    if (this._state === 'failed') return Promise.reject(this.failedError())
    if (this._state === 'ready') return Promise.resolve()
    if (!this.startPromise) {
      this.startPromise = this.spawnChild().finally(() => {
        this.startPromise = null
      })
    }
    return this.startPromise
  }

  async request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.start()
    const child = this.child
    if (!child) throw this.lastError ?? new Error(`${this.options.name} not running`)

    const id = this.nextId++
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.options.name} request timed out after ${this.options.requestTimeoutMs}ms`))
        // A child that stops answering is likely wedged; restart it rather than queue behind it.
        this.log.warn('request timed out; restarting helper')
        child.kill('SIGKILL')
      }, this.options.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ ...payload, id }) + '\n', (err) => {
        if (err) this.settle(id, new Error(`${this.options.name} stdin write failed: ${err.message}`))
      })
    })
    this.consecutiveFailures = 0
    return reply
  }

  async dispose(): Promise<void> {
    if (this._state === 'disposed') return
    this._state = 'disposed'
    this.rejectAll(new Error(`${this.options.name} disposed`))
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, this.options.disposeGraceMs ?? 1_000)
      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
      // The helper exits on stdin EOF after the request it is running, if any.
      child.stdin.end()
    })
  }

  private spawnChild(): Promise<void> {
    this._state = 'starting'
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let becameReady = false
      const finishStart = (err: Error | null): void => {
        if (settled) return
        settled = true
        clearTimeout(readyTimer)
        if (err) {
          this.recordFailure(err)
          reject(this._state === 'failed' ? this.failedError() : err)
        } else {
          becameReady = true
          this._state = 'ready'
          resolve()
        }
      }

      let child: ChildProcessWithoutNullStreams
      try {
        child = this.spawnFn(this.options.command, this.options.args)
      } catch (err) {
        settled = true
        const error = err instanceof Error ? err : new Error(String(err))
        this.recordFailure(error)
        reject(this._state === 'failed' ? this.failedError() : error)
        return
      }
      this.child = child

      const readyTimer = setTimeout(() => {
        finishStart(new Error(`${this.options.name} did not become ready within ${this.options.readyTimeoutMs}ms`))
        child.kill('SIGKILL')
      }, this.options.readyTimeoutMs)

      let buffer = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line) continue
          let message: Record<string, unknown>
          try {
            message = JSON.parse(line) as Record<string, unknown>
          } catch {
            // Never echo the line: it could contain transcript text.
            this.log.warn(`ignored non-JSON stdout line (${line.length} chars)`)
            continue
          }
          if (message.ready === true) {
            finishStart(null)
          } else if (typeof message.fatal === 'string') {
            finishStart(new Error(`${this.options.name} failed to start: ${message.fatal}`))
          } else if (typeof message.id === 'number') {
            this.settle(message.id, null, message)
          }
        }
      })

      // Without a listener, a write after the child died would throw from the stream.
      child.stdin.on('error', (err) => this.log.warn('stdin error:', err.message))

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        this.log.warn(`stderr: ${chunk.trim().slice(0, 500)}`)
      })

      child.on('error', (err) => {
        this.log.error('process error:', err.message)
        finishStart(err)
      })

      child.on('exit', (code, signal) => {
        if (this.child === child) this.child = null
        const exitError = new Error(`${this.options.name} exited (code ${code}, signal ${signal})`)
        if (!settled) {
          finishStart(exitError)
          return
        }
        // A start that already failed was counted when it failed.
        if (!becameReady || this._state === 'disposed') return
        this.log.warn(exitError.message)
        this.rejectAll(exitError)
        this.recordFailure(exitError)
        if (this._state !== 'failed') {
          this._state = 'stopped'
          this.start().catch((err: Error) => this.log.error('restart failed:', err.message))
        }
      })
    })
  }

  private settle(id: number, err: Error | null, reply?: Record<string, unknown>): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (err) entry.reject(err)
    else entry.resolve(reply!)
  }

  private rejectAll(err: Error): void {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      clearTimeout(entry.timer)
      entry.reject(err)
    }
  }

  private recordFailure(err: Error): void {
    this.lastError = err
    this.consecutiveFailures++
    if (this._state === 'disposed') return
    if (this.consecutiveFailures > this.options.maxRestarts) {
      this._state = 'failed'
      this.log.error(`giving up after ${this.consecutiveFailures} consecutive failures: ${err.message}`)
    } else {
      this._state = 'stopped'
    }
  }

  private failedError(): Error {
    return new Error(
      `${this.options.name} stopped after ${this.consecutiveFailures} consecutive failures: ${this.lastError?.message ?? 'unknown error'}`
    )
  }
}
