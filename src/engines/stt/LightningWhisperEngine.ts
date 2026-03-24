import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import {
  LIGHTNING_WHISPER_TRANSCRIBE_TIMEOUT_MS,
  LIGHTNING_WHISPER_INIT_TIMEOUT_MS
} from '../constants'

/**
 * Lightning Whisper MLX model size options.
 * See https://github.com/mustafaaljadery/lightning-whisper-mlx
 */
export type LightningWhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large'
  | 'large-v2'
  | 'large-v3'
  | 'distil-small.en'
  | 'distil-medium.en'
  | 'distil-large-v2'
  | 'distil-large-v3'

/**
 * Lightning Whisper MLX STT engine.
 * Achieves ~10x faster inference than whisper.cpp and ~4x faster than
 * standard MLX Whisper on Apple Silicon via optimized MLX kernels.
 *
 * Requires: python3 with `lightning-whisper-mlx` package installed.
 */
export class LightningWhisperEngine extends SubprocessBridge implements STTEngine {
  readonly id = 'lightning-whisper'
  readonly name = 'Lightning Whisper MLX (Apple Silicon, 10x faster)'
  readonly isOffline = true

  private model: LightningWhisperModel
  private batchSize: number
  private quant: '4bit' | '8bit' | null
  private onProgress?: (message: string) => void

  constructor(options?: {
    model?: LightningWhisperModel
    batchSize?: number
    quant?: '4bit' | '8bit' | null
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

  protected override onStatusMessage(status: string): void {
    this.onProgress?.(status)
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
      'Python 3 with lightning-whisper-mlx not found. Create a venv and install: ' +
      'python3 -m venv ~/mlx-env && ~/mlx-env/bin/pip install lightning-whisper-mlx'
    )
  }

  protected onInitComplete(_result: InitResult): void {
    this.onProgress?.('Lightning Whisper MLX ready')
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
        console.error('[lightning-whisper] Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        console.error('[lightning-whisper] Transcription error:', result.error)
        return null
      }

      if (!result.text || !(result.text as string).trim()) return null

      const detectedLang = result.language as string | undefined
      const language: Language = (detectedLang && ALL_LANGUAGES.includes(detectedLang as Language))
        ? (detectedLang as Language)
        : 'en'

      return {
        text: (result.text as string).trim(),
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } finally {
      try { unlinkSync(tempPath) } catch (e) { console.warn('[lightning-whisper] Failed to delete temp file:', e) }
    }
  }
}

/** Find a python3 binary that has lightning_whisper_mlx installed */
function findPython3WithLightningWhisper(): string {
  const venvPaths = [
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), 'lightning-whisper-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import lightning_whisper_mlx"`, { stdio: 'ignore', timeout: 5000 })
      return p
    } catch { /* lightning_whisper_mlx not installed in this venv */ }
  }

  // Fall back to system python3
  try {
    execSync('python3 -c "import lightning_whisper_mlx"', { stdio: 'ignore', timeout: 5000 })
    return 'python3'
  } catch { /* not available */ }

  throw new Error('lightning-whisper-mlx not found')
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
