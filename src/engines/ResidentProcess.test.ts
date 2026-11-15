import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ResidentProcess, type ResidentProcessOptions } from './ResidentProcess'

/** A fake helper: tests drive its stdout and observe what it receives on stdin. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly received: Record<string, unknown>[] = []

  constructor() {
    super()
    let buffer = ''
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        this.received.push(JSON.parse(buffer.slice(0, newline)))
        buffer = buffer.slice(newline + 1)
        this.emit('request', this.received[this.received.length - 1])
      }
    })
    this.stdin.on('finish', () => this.exit(0, null))
  }

  send(message: Record<string, unknown>): void {
    this.stdout.write(JSON.stringify(message) + '\n')
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.exit(null, signal)
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    setImmediate(() => this.emit('exit', code, signal))
  }
}

function setup(overrides: Partial<ResidentProcessOptions> = {}, onSpawn?: (child: FakeChild) => void) {
  const children: FakeChild[] = []
  const spawnFn = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    onSpawn?.(child)
    return child as unknown as ChildProcessWithoutNullStreams
  })
  const proc = new ResidentProcess({
    command: '/fake/helper',
    args: ['/fake/model'],
    name: 'test-helper',
    readyTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
    maxRestarts: 2,
    disposeGraceMs: 50,
    spawnFn,
    ...overrides
  })
  return { proc, children, spawnFn }
}

/** A helper that becomes ready at once and echoes each request's id with a fixed text. */
function healthy(child: FakeChild): void {
  setImmediate(() => child.send({ ready: true }))
  child.on('request', (req: Record<string, unknown>) => child.send({ id: req.id, text: 'ok' }))
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

afterEach(() => {
  vi.useRealTimers()
})

describe('ResidentProcess', () => {
  it('waits for the ready line before resolving start', async () => {
    const { proc, children } = setup()
    const started = proc.start()
    expect(proc.state).toBe('starting')
    children[0].send({ ready: true })
    await started
    expect(proc.state).toBe('ready')
  })

  it('spawns once when start is called concurrently', async () => {
    const { proc, spawnFn } = setup({}, healthy)
    await Promise.all([proc.start(), proc.start(), proc.request({ x: 1 })])
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('matches replies to requests by id, even out of order', async () => {
    const { proc, children } = setup({}, (child) => setImmediate(() => child.send({ ready: true })))
    await proc.start()
    const child = children[0]
    const first = proc.request({ n: 1 })
    const second = proc.request({ n: 2 })
    await tick()
    const [a, b] = child.received
    child.send({ id: b.id, text: 'second' })
    child.send({ id: a.id, text: 'first' })
    await expect(first).resolves.toMatchObject({ text: 'first' })
    await expect(second).resolves.toMatchObject({ text: 'second' })
    expect(a).toMatchObject({ n: 1 })
  })

  it('rejects start when the helper reports a fatal error', async () => {
    const { proc } = setup({}, (child) => setImmediate(() => {
      child.send({ fatal: 'model load failed' })
      child.exit(1, null)
    }))
    await expect(proc.start()).rejects.toThrow('model load failed')
    expect(proc.state).toBe('stopped')
  })

  it('rejects start when the helper never becomes ready', async () => {
    const { proc, children } = setup({ readyTimeoutMs: 20 })
    await expect(proc.start()).rejects.toThrow('did not become ready')
    expect(children[0].signalCode).toBe('SIGKILL')
  })

  it('rejects in-flight requests on a crash and restarts in the background', async () => {
    const { proc, children, spawnFn } = setup({}, (child) => setImmediate(() => child.send({ ready: true })))
    await proc.start()
    const inFlight = proc.request({ n: 1 })
    await tick()
    children[0].exit(null, 'SIGSEGV')
    await expect(inFlight).rejects.toThrow('exited')

    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(proc.state).toBe('ready'))
    const next = proc.request({ n: 2 })
    await tick()
    children[1].send({ id: children[1].received[0].id, text: 'after restart' })
    await expect(next).resolves.toMatchObject({ text: 'after restart' })
  })

  it('enters the failed state after too many consecutive failures and stays there', async () => {
    const { proc, spawnFn } = setup({ maxRestarts: 2 }, (child) => setImmediate(() => {
      child.send({ fatal: 'boom' })
      child.exit(1, null)
    }))
    await expect(proc.start()).rejects.toThrow('boom')
    await expect(proc.start()).rejects.toThrow('boom')
    await expect(proc.start()).rejects.toThrow('stopped after 3 consecutive failures')
    expect(proc.state).toBe('failed')
    await expect(proc.request({ n: 1 })).rejects.toThrow('stopped after 3 consecutive failures')
    expect(spawnFn).toHaveBeenCalledTimes(3)
  })

  it('resets the failure count after a successful reply', async () => {
    let spawned = 0
    const { proc } = setup({ maxRestarts: 1 }, (child) => {
      spawned++
      if (spawned === 1) {
        setImmediate(() => { child.send({ fatal: 'first start fails' }); child.exit(1, null) })
      } else {
        healthy(child)
      }
    })
    await expect(proc.start()).rejects.toThrow('first start fails')
    await expect(proc.request({ n: 1 })).resolves.toMatchObject({ text: 'ok' })
    expect(proc.state).toBe('ready')
  })

  it('times out a request and kills the wedged helper', async () => {
    const { proc, children } = setup({ requestTimeoutMs: 20 }, (child) => setImmediate(() => child.send({ ready: true })))
    await proc.start()
    await expect(proc.request({ n: 1 })).rejects.toThrow('timed out')
    expect(children[0].signalCode).toBe('SIGKILL')
  })

  it('ignores stdout lines that are not JSON', async () => {
    const { proc, children } = setup()
    const started = proc.start()
    children[0].stdout.write('some library banner\n')
    children[0].send({ ready: true })
    await expect(started).resolves.toBeUndefined()
  })

  it('closes stdin on dispose, rejects pending requests and refuses new ones', async () => {
    const { proc, children } = setup({}, (child) => setImmediate(() => child.send({ ready: true })))
    await proc.start()
    const pending = proc.request({ n: 1 })
    const rejected = expect(pending).rejects.toThrow('disposed')
    await tick()
    await proc.dispose()
    await rejected
    expect(children[0].exitCode).toBe(0)
    expect(proc.state).toBe('disposed')
    await expect(proc.request({ n: 2 })).rejects.toThrow('disposed')
  })

  it('does not restart after dispose', async () => {
    const { proc, spawnFn } = setup({}, healthy)
    await proc.start()
    await proc.dispose()
    await tick()
    await tick()
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('treats a spawn exception as a failed start', async () => {
    const proc = new ResidentProcess({
      command: '/missing', args: [], name: 'test-helper',
      readyTimeoutMs: 100, requestTimeoutMs: 100, maxRestarts: 0,
      spawnFn: () => { throw new Error('ENOENT') }
    })
    await expect(proc.start()).rejects.toThrow('stopped after 1 consecutive failures: ENOENT')
    expect(proc.state).toBe('failed')
  })
})
