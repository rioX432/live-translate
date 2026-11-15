/**
 * Minimal stand-in for the `electron` module so the real pipeline classes run
 * under plain Node. Only the APIs reached from TranslationPipeline, the engines
 * the bench uses, model-downloader and worker-pool are provided.
 */
import { EventEmitter } from 'events'
import { fork, type ChildProcess } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

function userDataDir(): string {
  // A dedicated directory keeps bench models and settings apart from the dev app's userData.
  return process.env.LT_BENCH_USERDATA ?? join(tmpdir(), 'live-translate-bench-userdata')
}

export const app = {
  getPath(name: string): string {
    if (name === 'userData') return userDataDir()
    if (name === 'temp') return tmpdir()
    return join(userDataDir(), name)
  },
  getVersion: () => '0.0.0-bench',
  isPackaged: false
}

/** Electron's UtilityProcess delivers the message itself, not a MessageEvent. */
class UtilityProcessAdapter extends EventEmitter {
  constructor(private readonly child: ChildProcess) {
    super()
    child.on('message', (msg) => this.emit('message', msg))
    child.on('exit', (code) => this.emit('exit', code ?? 0))
    child.on('spawn', () => this.emit('spawn'))
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  postMessage(message: unknown): void {
    if (this.child.connected) this.child.send(message as object)
  }

  kill(): boolean {
    return this.child.kill()
  }
}

/** PIDs of forked workers, read by the memory sampler to cover the whole process tree. */
export const forkedWorkerPids: number[] = []

export const utilityProcess = {
  fork(modulePath: string): UtilityProcessAdapter {
    const child = fork(modulePath, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    if (child.pid) forkedWorkerPids.push(child.pid)
    return new UtilityProcessAdapter(child)
  }
}

export default { app, utilityProcess }
