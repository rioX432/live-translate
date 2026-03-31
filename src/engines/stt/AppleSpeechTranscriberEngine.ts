import { execFile } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { createLogger } from '../../main/logger'
import {
  APPLE_STT_TRANSCRIBE_TIMEOUT_MS,
  APPLE_STT_INIT_TIMEOUT_MS
} from '../constants'

const log = createLogger('apple-stt')

/**
 * Well-known paths where the apple-stt binary may be installed.
 * Users build from scripts/apple-stt/ and place the binary in their PATH.
 */
const APPLE_STT_PATHS = [
  '/opt/homebrew/bin/apple-stt',
  '/usr/local/bin/apple-stt'
]

/**
 * Map from ISO 639-1 Language to BCP-47 locale identifier for SpeechTranscriber.
 */
const LANGUAGE_TO_LOCALE: Partial<Record<Language, string>> = {
  ja: 'ja-JP',
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  pt: 'pt-BR',
  ru: 'ru-RU',
  it: 'it-IT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  ar: 'ar-SA',
  th: 'th-TH',
  vi: 'vi-VN',
  id: 'id-ID'
}

/**
 * Apple SpeechTranscriber STT engine (macOS 26+ / Tahoe).
 *
 * Uses Apple's on-device SpeechTranscriber API via a Swift CLI bridge
 * (scripts/apple-stt). The bridge reads a WAV file and outputs
 * transcribed text to stdout.
 *
 * Key advantages:
 * - Zero model downloads (system-managed via AssetInventory)
 * - Uses Apple Neural Engine natively
 * - 55% faster than MacWhisper Large V3 Turbo (per Apple)
 * - Built-in Japanese support
 *
 * Requires macOS 26 (Tahoe) or later.
 *
 * Build the CLI:
 *   cd scripts/apple-stt && swift build -c release
 *   cp .build/release/apple-stt /opt/homebrew/bin/
 */
export class AppleSpeechTranscriberEngine implements STTEngine {
  readonly id = 'apple-speech-transcriber'
  readonly name = 'Apple SpeechTranscriber'
  readonly isOffline = true

  private binaryPath: string | null = null
  private initPromise: Promise<void> | null = null
  private sourceLocale: string
  private onProgress?: (message: string) => void

  constructor(options?: {
    /** BCP-47 locale for transcription (default: ja-JP) */
    locale?: string
    onProgress?: (message: string) => void
  }) {
    this.sourceLocale = options?.locale ?? 'ja-JP'
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.binaryPath) return

    this.onProgress?.('Locating apple-stt binary...')

    const found = findAppleSttBinary()
    if (!found) {
      throw new Error(
        'apple-stt binary not found. Build from scripts/apple-stt: ' +
        'cd scripts/apple-stt && swift build -c release && ' +
        'cp .build/release/apple-stt /opt/homebrew/bin/'
      )
    }
    this.binaryPath = found
    log.info(`Using apple-stt binary: ${this.binaryPath}`)

    // Warmup: triggers language model download on first run
    this.onProgress?.('Warming up Apple SpeechTranscriber (model download on first run)...')

    const warmupPath = join(tmpdir(), `apple-stt-warmup-${Date.now()}.wav`)
    try {
      writeSilentWav(warmupPath, 8000, 16000)
      await this.runTranscribe(warmupPath, APPLE_STT_INIT_TIMEOUT_MS)
      this.onProgress?.('Apple SpeechTranscriber ready')
    } catch (err) {
      log.warn('Warmup failed (language model may still be downloading):', err)
      this.onProgress?.('Apple SpeechTranscriber ready (warmup skipped)')
    } finally {
      try { unlinkSync(warmupPath) } catch { /* ignore */ }
    }
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.binaryPath) return null

    const tempPath = join(tmpdir(), `apple-stt-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)

      const text = await this.runTranscribe(tempPath, APPLE_STT_TRANSCRIBE_TIMEOUT_MS)
      if (!text.trim()) return null

      // SpeechTranscriber uses a fixed locale — derive language from it
      const language = localeToLanguage(this.sourceLocale)

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
   * Run `apple-stt transcribe <file>` and return stdout text.
   */
  private runTranscribe(audioPath: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.binaryPath) {
        reject(new Error('Binary path not set'))
        return
      }

      const args = ['transcribe', audioPath, '--locale', this.sourceLocale]

      execFile(this.binaryPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message
          reject(new Error(`apple-stt error: ${msg}`))
          return
        }
        resolve(stdout)
      })
    })
  }
}

/** Find the apple-stt binary in well-known paths */
function findAppleSttBinary(): string | null {
  for (const p of APPLE_STT_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

/** Convert BCP-47 locale to ISO 639-1 Language code */
function localeToLanguage(locale: string): Language {
  const lang = locale.split('-')[0]
  const known: Language[] = [
    'ja', 'en', 'zh', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'nl', 'pl', 'ar', 'th', 'vi', 'id'
  ]
  if (known.includes(lang as Language)) return lang as Language
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

/** Write a short silent WAV file for warmup */
function writeSilentWav(path: string, numSamples: number, sampleRate: number): void {
  const samples = new Float32Array(numSamples)
  writeWav(path, samples, sampleRate)
}

/** Exported locale map for use by other modules */
export { LANGUAGE_TO_LOCALE }
