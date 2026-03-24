import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'

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
export class QwenASREngine extends SubprocessBridge implements STTEngine {
  readonly id = 'qwen-asr'
  readonly name: string
  readonly isOffline = true

  private variant: QwenASRVariant
  private onProgress?: (message: string) => void

  constructor(options?: {
    variant?: QwenASRVariant
    onProgress?: (message: string) => void
  }) {
    super()
    this.variant = options?.variant ?? '0.6b'
    this.onProgress = options?.onProgress
    const config = QWEN_ASR_VARIANTS[this.variant]
    this.name = `Qwen3-ASR (${config.label})`
  }

  protected getLogPrefix(): string {
    return '[qwen-asr]'
  }

  protected getInitTimeout(): number {
    return INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return TRANSCRIBE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    const config = QWEN_ASR_VARIANTS[this.variant]
    this.onProgress?.(`Starting Qwen3-ASR ${config.label} bridge...`)
    const python3 = findPython3WithQwenASR()
    this.onProgress?.(`Using Python: ${python3}`)
    return {
      command: python3,
      args: [join(__dirname, '../../resources/qwen-asr-bridge.py')],
      initMessage: {
        action: 'init',
        model: config.modelId
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 with qwen-asr not found. Create a venv and install: ' +
      'python3 -m venv ~/qwen-asr-env && ~/qwen-asr-env/bin/pip install qwen-asr'
    )
  }

  protected onInitComplete(_result: InitResult): void {
    const config = QWEN_ASR_VARIANTS[this.variant]
    this.onProgress?.(`Qwen3-ASR ${config.label} ready`)
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `qwen-asr-${Date.now()}.wav`)
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
        console.error('[qwen-asr] Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        console.error('[qwen-asr] Transcription error:', result.error)
        return null
      }

      if (!result.text || !(result.text as string).trim()) return null

      // Qwen3-ASR provides built-in language detection (97.9% accuracy)
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
      try { unlinkSync(tempPath) } catch (e) { console.warn('[qwen-asr] Failed to delete temp file:', e) }
    }
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
