import { execFile } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { createLogger } from '../../main/logger'
import {
  SPEECH_SWIFT_TRANSCRIBE_TIMEOUT_MS,
  SPEECH_SWIFT_INIT_TIMEOUT_MS
} from '../constants'

const log = createLogger('speech-swift')

/** speech-swift model variant */
export type SpeechSwiftVariant = '0.6b' | '1.7b'

/** speech-swift model variant configuration */
export interface SpeechSwiftVariantConfig {
  /** CLI engine flag value */
  engine: string
  /** Approximate memory usage in MB */
  memoryMB: number
  /** Human-readable label */
  label: string
  /** Description shown in UI */
  description: string
}

/** Available speech-swift model variants */
export const SPEECH_SWIFT_VARIANTS: Record<SpeechSwiftVariant, SpeechSwiftVariantConfig> = {
  '0.6b': {
    engine: 'qwen3-mlx',
    memoryMB: 2200,
    label: '0.6B (Fast)',
    description: '0.6B params, ~2.2GB — RTF ~0.08, Swift native MLX'
  },
  '1.7b': {
    engine: 'qwen3-1.7b',
    memoryMB: 4000,
    label: '1.7B (Best Quality)',
    description: '1.7B params, ~4GB — SOTA accuracy, Swift native MLX'
  }
}

/** Well-known paths where the speech-swift `audio` binary may be installed */
const SPEECH_SWIFT_PATHS = [
  '/opt/homebrew/bin/audio',
  '/usr/local/bin/audio'
]

/**
 * Qwen3-ASR STT engine via speech-swift (Swift native, Apple Silicon only).
 *
 * speech-swift (qwen3-asr-swift) provides a native Swift + MLX implementation
 * of Qwen3-ASR. This engine spawns the `audio transcribe` CLI per audio chunk,
 * avoiding any Python dependency.
 *
 * Install via Homebrew:
 *   brew tap soniqo/speech https://github.com/soniqo/speech-swift
 *   brew install speech
 *
 * Or build from source:
 *   git clone https://github.com/soniqo/speech-swift && cd speech-swift && make build
 */
export class SpeechSwiftEngine implements STTEngine {
  readonly id = 'speech-swift'
  readonly name: string
  readonly isOffline = true

  private variant: SpeechSwiftVariant
  private binaryPath: string | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void

  constructor(options?: {
    variant?: SpeechSwiftVariant
    onProgress?: (message: string) => void
  }) {
    this.variant = options?.variant ?? '0.6b'
    this.onProgress = options?.onProgress
    const config = SPEECH_SWIFT_VARIANTS[this.variant]
    this.name = `Qwen3-ASR Swift (${config.label})`
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.binaryPath) return

    this.onProgress?.('Locating speech-swift binary...')

    // Find the `audio` binary
    const found = findSpeechSwiftBinary()
    if (!found) {
      throw new Error(
        'speech-swift `audio` binary not found. Install via Homebrew: ' +
        'brew tap soniqo/speech https://github.com/soniqo/speech-swift && brew install speech'
      )
    }
    this.binaryPath = found
    log.info(`Using speech-swift binary: ${this.binaryPath}`)

    // Warmup: run a version check / short transcription to trigger model download
    this.onProgress?.('Warming up Qwen3-ASR (model download on first run)...')

    const config = SPEECH_SWIFT_VARIANTS[this.variant]
    const warmupPath = join(tmpdir(), `speech-swift-warmup-${Date.now()}.wav`)

    try {
      // Generate a short silent WAV for warmup (0.5s silence)
      writeSilentWav(warmupPath, 8000, 16000)

      await this.runTranscribe(warmupPath, SPEECH_SWIFT_INIT_TIMEOUT_MS)
      this.onProgress?.(`Qwen3-ASR Swift ${config.label} ready`)
    } catch (err) {
      // If warmup fails, the binary may still work for real audio
      log.warn('Warmup failed (model may still be downloading):', err)
      this.onProgress?.(`Qwen3-ASR Swift ${config.label} ready (warmup skipped)`)
    } finally {
      try { unlinkSync(warmupPath) } catch { /* ignore */ }
    }
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.binaryPath) return null

    const tempPath = join(tmpdir(), `speech-swift-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)

      const text = await this.runTranscribe(tempPath, SPEECH_SWIFT_TRANSCRIBE_TIMEOUT_MS)
      if (!text.trim()) return null

      // speech-swift does not output language info via CLI —
      // use script-based fallback detection
      const language = detectLanguageFallback(text.trim())

      return {
        text: text.trim(),
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } catch (err) {
      log.error('Transcription error:', err instanceof Error ? err.message : err)
      return null
    } finally {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }

  async dispose(): Promise<void> {
    log.info('Disposing resources')
    this.binaryPath = null
    this.initPromise = null
  }

  /**
   * Run `audio transcribe <file>` and return the stdout text.
   */
  private runTranscribe(audioPath: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.binaryPath) {
        reject(new Error('Binary path not set'))
        return
      }

      const config = SPEECH_SWIFT_VARIANTS[this.variant]
      const args = ['transcribe', '--engine', config.engine, audioPath]

      execFile(this.binaryPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message
          reject(new Error(`speech-swift error: ${msg}`))
          return
        }
        resolve(stdout)
      })
    })
  }
}

/** Find the speech-swift `audio` binary */
function findSpeechSwiftBinary(): string | null {
  for (const p of SPEECH_SWIFT_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Fallback script-based language detection when the model does not
 * provide a language field.
 */
function detectLanguageFallback(text: string): Language {
  if (!text) return 'en'

  const jpKana = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g)
  const jpCount = jpKana?.length ?? 0
  if (jpCount / text.length > 0.3 && jpCount >= 2) return 'ja'

  const cjk = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)
  const cjkCount = cjk?.length ?? 0
  if (cjkCount / text.length > 0.3 && cjkCount >= 2 && jpCount === 0) return 'zh'

  const ko = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g)
  const koCount = ko?.length ?? 0
  if (koCount / text.length > 0.3 && koCount >= 2) return 'ko'

  const th = text.match(/[\u0E00-\u0E7F]/g)
  const thCount = th?.length ?? 0
  if (thCount / text.length > 0.3 && thCount >= 2) return 'th'

  const ar = text.match(/[\u0600-\u06FF\u0750-\u077F]/g)
  const arCount = ar?.length ?? 0
  if (arCount / text.length > 0.3 && arCount >= 2) return 'ar'

  return 'en'
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

/** Write a short silent WAV file for warmup */
function writeSilentWav(path: string, numSamples: number, sampleRate: number): void {
  const samples = new Float32Array(numSamples)
  writeWav(path, samples, sampleRate)
}
