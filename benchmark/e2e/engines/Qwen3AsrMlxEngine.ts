import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { createInterface } from 'readline'
import type { Language, STTEngine, STTResult } from '../../../src/engines/types'

interface Pending {
  resolve: (r: { text: string; language: string; ms: number }) => void
  reject: (e: Error) => void
}

/**
 * Bench-only STT engine: Qwen3-ASR through a resident mlx-audio Python process.
 * Requests are serialized because one MLX model cannot run two decodes at once.
 */
export class Qwen3AsrMlxEngine implements STTEngine {
  readonly id: string
  readonly name: string
  readonly isOffline = true
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private nextId = 0
  private chain: Promise<unknown> = Promise.resolve()
  /** Model-side processing time of every call, for RTF reporting. */
  readonly callMs: number[] = []

  constructor(
    private readonly opts: { python: string; model: string; hotwords?: string[]; id?: string }
  ) {
    this.id = opts.id ?? 'qwen3-asr-mlx'
    this.name = `Qwen3-ASR MLX (${opts.model})`
  }

  async initialize(): Promise<void> {
    if (this.proc) return
    const script = join(__dirname, '..', 'py', 'qwen3_asr_server.py')
    const proc = spawn(this.opts.python, ['-I', script, this.opts.model, ...(this.opts.hotwords ?? [])], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc
    proc.stderr.on('data', (d) => process.stderr.write(`[qwen3-asr-mlx] ${d}`))
    const rl = createInterface({ input: proc.stdout })
    await new Promise<void>((resolve, reject) => {
      proc.once('exit', (code) => reject(new Error(`qwen3 server exited ${code}`)))
      rl.on('line', (line) => {
        const msg = JSON.parse(line)
        if (msg.ready) return resolve()
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        p.resolve(msg)
      })
    })
  }

  async processAudio(audioChunk: Float32Array, _sampleRate: number): Promise<STTResult | null> {
    const run = async (): Promise<STTResult | null> => {
      if (!this.proc) return null
      const id = this.nextId++
      const b64 = Buffer.from(audioChunk.buffer, audioChunk.byteOffset, audioChunk.byteLength).toString('base64')
      const res = await new Promise<{ text: string; language: string; ms: number }>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        this.proc!.stdin.write(JSON.stringify({ id, pcm_f32_b64: b64 }) + '\n')
      })
      this.callMs.push(res.ms)
      if (!res.text) return null
      // Pass other languages through so a misdetection shows up in language-ID scoring.
      const language = (res.language || 'en') as Language
      return { text: res.text, language, isFinal: true, timestamp: Date.now() }
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => undefined)
    return p
  }

  async dispose(): Promise<void> {
    this.proc?.stdin.end()
    this.proc?.kill()
    this.proc = null
  }
}
