import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import { LIGHTNING_WHISPER_TRANSCRIBE_TIMEOUT_MS, LIGHTNING_WHISPER_INIT_TIMEOUT_MS } from '../constants'

/** Lightning Whisper MLX model variants */
export type LightningWhisperModel =
  | 'tiny' | 'base' | 'small' | 'medium'
  | 'distil-small.en' | 'distil-medium.en'
  | 'large' | 'large-v2' | 'large-v3'
  | 'distil-large-v2' | 'distil-large-v3'

/** Quantization options for Lightning Whisper MLX */
export type LightningWhisperQuant = null | '4bit' | '8bit'

export class LightningWhisperEngine extends SubprocessBridge implements STTEngine {
  readonly id = 'lightning-whisper'
  readonly name = 'Lightning Whisper MLX (Apple Silicon, 10x faster)'
  readonly isOffline = true

  private model: LightningWhisperModel
  private batchSize: number
  private quant: LightningWhisperQuant
  private onProgress?: (message: string) => void

  constructor(options?: {
    model?: LightningWhisperModel
    batchSize?: number
    quant?: LightningWhisperQuant
    onProgress?: (message: string) => void
  }) {
    super()
    this.model = options?.model ?? 'distil-large-v3'
    this.batchSize = options?.batchSize ?? 12
    this.quant = options?.quant ?? null
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[lightning-whisper]'
  }

  protected getInitTimeout(): number {
    return LIGHTNING_WHISPER_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return LIGHTNING_WHISPER_TRANSCRIBE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting Lightning Whisper MLX bridge...')
    const python3 = findPython3WithLightningWhisper()
    this.onProgress?.(`Using Python: ${python3}`)
    return {
      command: python3,
      args: [join(__dirname, '../../resources/lightning-whisper-bridge.py')],
      initMessage: {
        action: 'init',
        model: this.model,
        batch_size: this.batchSize,
        quant: this.quant
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 with lightning-whisper-mlx not found. Create a venv and install: python3 -m venv ~/mlx-env && ~/mlx-env/bin/pip install lightning-whisper-mlx'
    )
  }

  protected onInitComplete(result: InitResult): void {
    const engine = result.engine as string | undefined
    if (engine === 'mlx-whisper-fallback') {
      this.onProgress?.('Lightning Whisper MLX unavailable, using mlx-whisper fallback')
    } else {
      this.onProgress?.('Lightning Whisper MLX ready')
    }
  }

  protected onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `lightning-whisper-${Date.now()}.wav`)
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
        console.error('[lightning-whisper] Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        console.error('[lightning-whisper] Transcription error:', result.error)
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
      try { unlinkSync(tempPath) } catch (e) { console.warn('[lightning-whisper] Failed to delete temp file:', e) }
    }
  }
}

/**
 * Find a python3 binary that has lightning_whisper_mlx or mlx_whisper installed.
 * Prefers lightning_whisper_mlx but accepts mlx_whisper as fallback
 * (the bridge handles the fallback logic).
 */
function findPython3WithLightningWhisper(): string {
  const venvPaths = [
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  // First pass: look for lightning_whisper_mlx
  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import lightning_whisper_mlx"`, { stdio: 'ignore', timeout: 5000 })
      return p
    } catch { /* not installed in this venv */ }
  }

  // System python3 with lightning_whisper_mlx
  try {
    execSync('python3 -c "import lightning_whisper_mlx"', { stdio: 'ignore', timeout: 5000 })
    return 'python3'
  } catch { /* not available */ }

  // Second pass: accept mlx_whisper as fallback
  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import mlx_whisper"`, { stdio: 'ignore', timeout: 5000 })
      return p
    } catch { /* not installed in this venv */ }
  }

  try {
    execSync('python3 -c "import mlx_whisper"', { stdio: 'ignore', timeout: 5000 })
    return 'python3'
  } catch { /* not available */ }

  throw new Error('Neither lightning-whisper-mlx nor mlx-whisper found')
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
