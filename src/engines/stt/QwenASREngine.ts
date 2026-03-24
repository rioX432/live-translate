import { spawn, execSync, type ChildProcess } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'

const TRANSCRIBE_TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 120_000

/** Qwen3-ASR model variant */
export type QwenASRVariant = '0.6b' | '1.7b'

/** Qwen3-ASR model variant configuration */
export interface QwenASRVariantConfig {
  /** HuggingFace model ID */
  modelId: string
  /** Approximate model size in MB */
  sizeMB: number
  /** Human-readable label */
  label: string
  /** Description shown in UI */
  description: string
}

/** Available Qwen3-ASR model variants */
export const QWEN_ASR_VARIANTS: Record<QwenASRVariant, QwenASRVariantConfig> = {
  '0.6b': {
    modelId: 'Qwen/Qwen3-ASR-0.6B',
    sizeMB: 1800,
    label: '0.6B (Fast)',
    description: '0.6B params, ~1.8GB — lowest latency, 92ms TTFT'
  },
  '1.7b': {
    modelId: 'Qwen/Qwen3-ASR-1.7B',
    sizeMB: 3500,
    label: '1.7B (Best Quality)',
    description: '2B params, ~3.5GB — SOTA accuracy, competitive with GPT-4o'
  }
}

/**
 * Qwen3-ASR STT engine using Python subprocess bridge.
 * Supports 52 languages/dialects with strong CJK performance.
 * Requires: python3 with `qwen-asr` package installed.
 */
export class QwenASREngine implements STTEngine {
  readonly id = 'qwen-asr'
  readonly name: string
  readonly isOffline = true

  private process: ChildProcess | null = null
  private initPromise: Promise<void> | null = null
  private variant: QwenASRVariant
  private onProgress?: (message: string) => void
  private pendingRequests = new Map<number, (data: any) => void>()
  private nextRequestId = 0
  private buffer = ''
  private stderrRateLimit = { count: 0, lastReset: Date.now() }

  constructor(options?: {
    variant?: QwenASRVariant
    onProgress?: (message: string) => void
  }) {
    this.variant = options?.variant ?? '0.6b'
    this.onProgress = options?.onProgress
    const config = QWEN_ASR_VARIANTS[this.variant]
    this.name = `Qwen3-ASR (${config.label})`
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.process) return

    const config = QWEN_ASR_VARIANTS[this.variant]
    this.onProgress?.(`Starting Qwen3-ASR ${config.label} bridge...`)

    const bridgePath = join(__dirname, '../../resources/qwen-asr-bridge.py')

    const initTimeout = setTimeout(() => {
      console.error('[qwen-asr] Initialization timed out')
      try { this.process?.kill() } catch { /* ignore */ }
      this.process = null
    }, INIT_TIMEOUT_MS)

    try {
      const python3 = findPython3WithQwenASR()
      this.onProgress?.(`Using Python: ${python3}`)
      this.process = spawn(python3, [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      clearTimeout(initTimeout)
      throw new Error(
        'Python 3 with qwen-asr not found. Create a venv and install: ' +
        'python3 -m venv ~/qwen-asr-env && ~/qwen-asr-env/bin/pip install qwen-asr'
      )
    }

    this.process.on('error', (err) => {
      clearTimeout(initTimeout)
      console.error('[qwen-asr] Failed to start Python bridge:', err.message)
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
          if (reqId !== undefined && this.pendingRequests.has(reqId)) {
            this.pendingRequests.get(reqId)!(msg)
            this.pendingRequests.delete(reqId)
          }
        } catch {
          console.warn('[qwen-asr] Invalid JSON from bridge:', line)
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
        console.warn('[qwen-asr] stderr:', data.toString().trim())
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[qwen-asr] Bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command with model ID
    try {
      const result = await this.sendCommand({
        action: 'init',
        model: config.modelId
      })
      if (result.error) {
        throw new Error(`Qwen3-ASR init failed: ${result.error}`)
      }
      this.onProgress?.(`Qwen3-ASR ${config.label} ready`)
    } catch (err) {
      if (this.process) {
        try { this.process.kill() } catch { /* ignore */ }
        this.process = null
      }
      throw err
    } finally {
      clearTimeout(initTimeout)
    }
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `qwen-asr-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)

      let result: any
      try {
        result = await this.sendCommand({
          action: 'transcribe',
          audio_path: tempPath,
          sample_rate: sampleRate
        })
      } catch (err) {
        console.error('[qwen-asr] Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        console.error('[qwen-asr] Transcription error:', result.error)
        return null
      }

      if (!result.text || !result.text.trim()) return null

      // Qwen3-ASR provides built-in language detection (97.9% accuracy)
      const detectedLang = result.language as string | undefined
      const language: Language = (detectedLang && ALL_LANGUAGES.includes(detectedLang as Language))
        ? (detectedLang as Language)
        : 'en'

      return {
        text: result.text.trim(),
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } finally {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }

  async dispose(): Promise<void> {
    console.log('[qwen-asr] Disposing resources')
    if (this.process) {
      try {
        this.sendCommand({ action: 'dispose' }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch { /* ignore */ }
      try {
        this.process.kill()
      } catch { /* ignore */ }
      this.process = null
    }
    const pending = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()
    for (const resolve of pending) {
      resolve({ error: 'Engine disposed' })
    }
    this.initPromise = null
  }

  private sendCommand(cmd: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Bridge process not running'))
        return
      }

      const reqId = this.nextRequestId++ % 0xFFFFFF

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error('Bridge command timed out'))
      }, TRANSCRIBE_TIMEOUT_MS)

      this.pendingRequests.set(reqId, (data) => {
        clearTimeout(timeout)
        resolve(data)
      })

      const written = this.process.stdin.write(JSON.stringify({ ...cmd, _reqId: reqId }) + '\n')
      if (!written) {
        this.process.stdin.once('drain', () => { /* backpressure resolved */ })
      }
      this.process.stdin.once('error', (err) => {
        this.pendingRequests.delete(reqId)
        clearTimeout(timeout)
        reject(new Error(`stdin write error: ${err.message}`))
      })
    })
  }
}

/** Find a python3 binary that has qwen_asr installed */
function findPython3WithQwenASR(): string {
  const venvPaths = [
    join(homedir(), 'qwen-asr-env', 'bin', 'python3'),
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import qwen_asr"`, { stdio: 'ignore', timeout: 5000 })
      return p
    } catch { /* qwen_asr not installed in this venv */ }
  }

  // Fall back to system python3
  try {
    execSync('python3 -c "import qwen_asr"', { stdio: 'ignore', timeout: 5000 })
    return 'python3'
  } catch { /* not available */ }

  throw new Error('qwen-asr not found')
}

/** Write Float32Array as a minimal WAV file */
function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataSize = samples.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // WAV header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28)
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Convert Float32 [-1, 1] to Int16
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }

  writeFileSync(path, buffer)
}
