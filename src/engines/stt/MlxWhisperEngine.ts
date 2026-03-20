import { spawn, execSync, type ChildProcess } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'

const TRANSCRIBE_TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 60_000

export class MlxWhisperEngine implements STTEngine {
  readonly id = 'mlx-whisper'
  readonly name = 'mlx-whisper (Apple Silicon)'
  readonly isOffline = true

  private process: ChildProcess | null = null
  private model: string
  private onProgress?: (message: string) => void
  private pendingRequests = new Map<number, (data: any) => void>()
  private nextRequestId = 0
  private buffer = ''
  private stderrRateLimit = { count: 0, lastReset: Date.now() }

  constructor(options?: {
    model?: string
    onProgress?: (message: string) => void
  }) {
    this.model = options?.model ?? 'mlx-community/whisper-large-v3-turbo'
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.process) return

    this.onProgress?.('Starting mlx-whisper bridge...')

    // Find the bridge script
    const bridgePath = join(__dirname, '../../resources/mlx-whisper-bridge.py')

    // Overall init timeout — kills the process if bridge doesn't respond (#228)
    const initTimeout = setTimeout(() => {
      console.error('[mlx-whisper] Initialization timed out')
      try { this.process?.kill() } catch { /* ignore */ }
      this.process = null
    }, INIT_TIMEOUT_MS)

    try {
      const python3 = findPython3WithMlxWhisper()
      this.onProgress?.(`Using Python: ${python3}`)
      this.process = spawn(python3, [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      clearTimeout(initTimeout)
      throw new Error('Python 3 with mlx-whisper not found. Create a venv and install: python3 -m venv ~/mlx-env && ~/mlx-env/bin/pip install mlx-whisper')
    }

    // Handle spawn errors (python3 not in PATH)
    this.process.on('error', (err) => {
      clearTimeout(initTimeout)
      console.error('[mlx-whisper] Failed to start Python bridge:', err.message)
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
          console.warn('[mlx-whisper] Invalid JSON from bridge:', line)
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
        console.warn('[mlx-whisper] stderr:', data.toString().trim())
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[mlx-whisper] Bridge exited with code ${code}`)
      this.process = null
    })

    // Send init command — kill process on failure to prevent orphaned subprocesses (#210)
    try {
      const result = await this.sendCommand({ action: 'init', model: this.model })
      if (result.error) {
        throw new Error(`mlx-whisper init failed: ${result.error}`)
      }
      this.onProgress?.('mlx-whisper ready')
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

    const tempPath = join(tmpdir(), `mlx-whisper-${Date.now()}.wav`)
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
        // Timeout or bridge error — return null per interface contract
        console.error('[mlx-whisper] Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        console.error('[mlx-whisper] Transcription error:', result.error)
        return null
      }

      if (!result.text || !result.text.trim()) return null

      return {
        text: result.text,
        language: (ALL_LANGUAGES.includes(result.language as Language) ? result.language : 'en') as Language,
        isFinal: true,
        timestamp: Date.now()
      }
    } finally {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }

  async dispose(): Promise<void> {
    console.log('[mlx-whisper] Disposing resources')
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
    // Snapshot pending requests to avoid concurrent modification from stdout handler
    const pending = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()
    for (const resolve of pending) {
      resolve({ error: 'Engine disposed' })
    }
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

/** Find a python3 binary that has mlx_whisper installed */
function findPython3WithMlxWhisper(): string {
  // Check common venv locations first
  const venvPaths = [
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import mlx_whisper"`, { stdio: 'ignore', timeout: 5000 })
      return p
    } catch { /* mlx_whisper not installed in this venv */ }
  }

  // Fall back to system python3
  try {
    execSync('python3 -c "import mlx_whisper"', { stdio: 'ignore', timeout: 5000 })
    return 'python3'
  } catch { /* not available */ }

  throw new Error('mlx-whisper not found')
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
