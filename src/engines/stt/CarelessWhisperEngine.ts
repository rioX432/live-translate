import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import {
  CARELESS_WHISPER_TRANSCRIBE_TIMEOUT_MS,
  CARELESS_WHISPER_INIT_TIMEOUT_MS,
  PYTHON_IMPORT_CHECK_TIMEOUT_MS
} from '../constants'

/**
 * CarelessWhisper — causal streaming adaptation of Whisper via LoRA fine-tuning.
 *
 * Converts stock Whisper into a causal encoder that processes <300ms audio chunks
 * directly, without the Local Agreement algorithm that requires multiple overlapping
 * chunks to stabilize output.
 *
 * Key advantages over Local Agreement:
 * - Sub-300ms chunk latency (vs ~3s chunks for Local Agreement)
 * - No multi-pass stabilization needed — each chunk produces final output
 * - LoRA overhead is negligible (~0.5% params), can hot-swap causal/non-causal
 *
 * Limitations:
 * - EN-only for small/medium models; large-v2 supports en/fr/es/de/pt
 * - No Japanese support yet — not suitable as primary STT for JA use cases
 * - Requires careless-whisper-stream Python package + torch
 * - Higher WER than non-causal Whisper (tradeoff for streaming latency)
 *
 * References:
 * - Paper: https://arxiv.org/abs/2508.12301
 * - Code: https://github.com/tomer9080/CarelessWhisper-streaming
 *
 * TODO: Benchmark JA/EN CER/WER vs current Local Agreement approach
 * TODO: Evaluate LoRA weight integration with whisper.cpp (GGML format)
 * TODO: Evaluate LoRA weight integration with MLX Whisper (MLX format)
 * TODO: Measure end-to-end latency in Electron pipeline
 * TODO: Test large-v2 multilingual model for JA support feasibility
 */
export class CarelessWhisperEngine extends SubprocessBridge implements STTEngine {
  readonly id = 'careless-whisper'
  readonly name = 'CarelessWhisper (Causal streaming)'
  readonly isOffline = true

  private modelSize: string
  private chunkSizeMs: number
  private device: string
  private multilingual = false
  private supportedLanguages: string[] = ['en']
  private onProgress?: (message: string) => void

  constructor(options?: {
    /** Model size: 'small' | 'medium' (EN-only) or 'large-v2' (multilingual) */
    modelSize?: string
    /** Audio chunk size in ms (default 300) */
    chunkSizeMs?: number
    /** Device: 'auto' | 'cpu' | 'cuda' | 'mps' */
    device?: string
    onProgress?: (message: string) => void
  }) {
    super()
    this.modelSize = options?.modelSize ?? 'small'
    this.chunkSizeMs = options?.chunkSizeMs ?? 300
    this.device = options?.device ?? 'auto'
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[careless-whisper]'
  }

  protected getInitTimeout(): number {
    return CARELESS_WHISPER_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return CARELESS_WHISPER_TRANSCRIBE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting CarelessWhisper bridge...')
    const python3 = findPython3WithCarelessWhisper()
    this.onProgress?.(`Using Python: ${python3}`)
    return {
      command: python3,
      args: [join(__dirname, '../../resources/careless-whisper-bridge.py')],
      initMessage: {
        action: 'init',
        model_size: this.modelSize,
        chunk_size_ms: this.chunkSizeMs,
        device: this.device
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 with careless-whisper-stream and torch not found. ' +
      'Install: pip install careless-whisper-stream torch'
    )
  }

  protected onInitComplete(result: InitResult): void {
    this.multilingual = result.multilingual as boolean ?? false
    this.supportedLanguages = (result.supported_languages as string[]) ?? ['en']
    const device = (result.device as string) ?? 'unknown'
    const modelSize = (result.model_size as string) ?? this.modelSize
    this.onProgress?.(
      `CarelessWhisper ready (${modelSize}, ${device}, ` +
      `${this.chunkSizeMs}ms chunks, ` +
      `langs: ${this.supportedLanguages.join('/')})`
    )
  }

  protected override onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `careless-whisper-${Date.now()}.wav`)
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
        this.log.error('Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        this.log.error('Transcription error:', result.error)
        return null
      }

      if (!result.text || !(result.text as string).trim()) return null

      const detectedLang = result.language as string ?? 'en'
      const language: Language = ALL_LANGUAGES.includes(detectedLang as Language)
        ? (detectedLang as Language)
        : 'en'

      return {
        text: (result.text as string).trim(),
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } finally {
      try { unlinkSync(tempPath) } catch (e) { this.log.warn('Failed to delete temp file:', e) }
    }
  }
}

/**
 * Find a python3 binary that has careless_whisper_stream and torch installed.
 * Prefers Python 3.12 (3.14 has segfault issues with torch on Apple Silicon).
 */
function findPython3WithCarelessWhisper(): string {
  const venvPaths = [
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import careless_whisper_stream; import torch"`, {
        stdio: 'ignore',
        timeout: PYTHON_IMPORT_CHECK_TIMEOUT_MS
      })
      return p
    } catch { /* deps not installed in this venv */ }
  }

  for (const bin of ['python3.12', 'python3.13', 'python3']) {
    try {
      execSync(`${bin} -c "import careless_whisper_stream; import torch"`, {
        stdio: 'ignore',
        timeout: PYTHON_IMPORT_CHECK_TIMEOUT_MS
      })
      return bin
    } catch { /* not available or deps not installed */ }
  }

  throw new Error('Python 3 with careless-whisper-stream and torch not found')
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
  buffer.writeUInt32LE(16, 16)
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
