import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'

const TRANSCRIBE_TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 60_000

export class MlxWhisperEngine extends SubprocessBridge implements STTEngine {
  readonly id = 'mlx-whisper'
  readonly name = 'mlx-whisper (Apple Silicon)'
  readonly isOffline = true

  private model: string
  private onProgress?: (message: string) => void

  constructor(options?: {
    model?: string
    onProgress?: (message: string) => void
  }) {
    super()
    this.model = options?.model ?? 'mlx-community/whisper-large-v3-turbo'
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[mlx-whisper]'
  }

  protected getInitTimeout(): number {
    return INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return TRANSCRIBE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting mlx-whisper bridge...')
    const python3 = findPython3WithMlxWhisper()
    this.onProgress?.(`Using Python: ${python3}`)
    return {
      command: python3,
      args: [join(__dirname, '../../resources/mlx-whisper-bridge.py')],
      initMessage: {
        action: 'init',
        model: this.model
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 with mlx-whisper not found. Create a venv and install: python3 -m venv ~/mlx-env && ~/mlx-env/bin/pip install mlx-whisper'
    )
  }

  protected onInitComplete(_result: InitResult): void {
    this.onProgress?.('mlx-whisper ready')
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `mlx-whisper-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)

      let result: Record<string, unknown>
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

      if (!result.text || !(result.text as string).trim()) return null

      return {
        text: result.text as string,
        language: (ALL_LANGUAGES.includes(result.language as Language) ? result.language : 'en') as Language,
        isFinal: true,
        timestamp: Date.now()
      }
    } finally {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
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
