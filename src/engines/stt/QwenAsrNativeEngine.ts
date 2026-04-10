import { execFile, execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('qwen-asr-native')

/** qwen-asr model variant */
export type QwenAsrNativeVariant = '0.6b' | '1.7b'

/** qwen-asr variant configuration */
export interface QwenAsrNativeVariantConfig {
  /** Model directory name (e.g. "qwen3-asr-0.6b") */
  dirName: string
  /** Approximate model size in MB */
  sizeMB: number
  /** Human-readable label */
  label: string
  /** Description shown in UI */
  description: string
}

/** Available model variants for antirez/qwen-asr */
export const QWEN_ASR_NATIVE_VARIANTS: Record<QwenAsrNativeVariant, QwenAsrNativeVariantConfig> = {
  '0.6b': {
    dirName: 'qwen3-asr-0.6b',
    sizeMB: 1200,
    label: '0.6B (Fast)',
    description: '0.6B params, ~1.2GB safetensors — 92ms TTFT, ~7.99x realtime on M3 Max'
  },
  '1.7b': {
    dirName: 'qwen3-asr-1.7b',
    sizeMB: 3400,
    label: '1.7B (Best Quality)',
    description: '1.7B params, ~3.4GB safetensors — SOTA accuracy, competitive with GPT-4o'
  }
}

/** Timeout for transcription (ms) */
const TRANSCRIBE_TIMEOUT_MS = 30_000

/** Timeout for warmup / first-run model load (ms) */
const INIT_TIMEOUT_MS = 120_000

/** Well-known paths where the qwen_asr binary may be installed */
const QWEN_ASR_BINARY_PATHS = [
  '/opt/homebrew/bin/qwen_asr',
  '/usr/local/bin/qwen_asr',
  // Build from source in home directory
  join(homedir(), 'qwen-asr', 'qwen_asr')
]

/**
 * Qwen3-ASR STT engine via antirez/qwen-asr pure C implementation.
 *
 * Uses the qwen_asr CLI binary compiled from https://github.com/antirez/qwen-asr.
 * Pure C with only BLAS dependency (Accelerate on macOS, OpenBLAS on Linux).
 * Models use safetensors format with memory-mapped loading for near-instant startup.
 *
 * Advantages over speech-swift and Python bridge:
 * - Cross-platform (macOS + Linux), not Apple-only
 * - No Python dependency, no Swift dependency
 * - Streaming mode with sliding window and prefix rollback
 * - Token-by-token callback support in C API
 * - Memory-mapped model loading (near-instant)
 *
 * Install:
 *   git clone https://github.com/antirez/qwen-asr
 *   cd qwen-asr && make blas
 *   ./download_model.sh   # Select 0.6B or 1.7B
 *
 * Future: Replace CLI spawning with native Node.js addon wrapping qwen_asr.h
 * for lower latency and streaming callback support.
 */
export class QwenAsrNativeEngine implements STTEngine {
  readonly id = 'qwen-asr-native'
  readonly name: string
  readonly isOffline = true

  private variant: QwenAsrNativeVariant
  private binaryPath: string | null = null
  private modelDir: string | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void

  constructor(options?: {
    variant?: QwenAsrNativeVariant
    binaryPath?: string
    modelDir?: string
    onProgress?: (message: string) => void
  }) {
    this.variant = options?.variant ?? '0.6b'
    this.onProgress = options?.onProgress
    // Allow explicit binary/model path override for testing
    if (options?.binaryPath) this.binaryPath = options.binaryPath
    if (options?.modelDir) this.modelDir = options.modelDir
    const config = QWEN_ASR_NATIVE_VARIANTS[this.variant]
    this.name = `Qwen3-ASR Native (${config.label})`
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.binaryPath && this.modelDir) return

    this.onProgress?.('Locating qwen_asr binary...')

    // Find binary
    if (!this.binaryPath) {
      const found = findQwenAsrBinary()
      if (!found) {
        throw new Error(
          'qwen_asr binary not found. Build from source:\n' +
          '  git clone https://github.com/antirez/qwen-asr\n' +
          '  cd qwen-asr && make blas\n' +
          '  ./download_model.sh'
        )
      }
      this.binaryPath = found
    }
    log.info(`Using qwen_asr binary: ${this.binaryPath}`)

    // Find model directory
    if (!this.modelDir) {
      const config = QWEN_ASR_NATIVE_VARIANTS[this.variant]
      const found = findModelDir(this.binaryPath, config.dirName)
      if (!found) {
        throw new Error(
          `Model directory '${config.dirName}' not found. Download the model:\n` +
          `  cd ${dirname(this.binaryPath)} && ./download_model.sh`
        )
      }
      this.modelDir = found
    }
    log.info(`Using model directory: ${this.modelDir}`)

    // Warmup: run a short transcription to verify everything works
    this.onProgress?.(`Warming up Qwen3-ASR ${QWEN_ASR_NATIVE_VARIANTS[this.variant].label}...`)

    const warmupPath = join(tmpdir(), `qwen-asr-native-warmup-${Date.now()}.wav`)
    try {
      writeSilentWav(warmupPath, 8000, 16000)
      await this.runTranscribe(warmupPath, INIT_TIMEOUT_MS)
      this.onProgress?.(`Qwen3-ASR Native ${QWEN_ASR_NATIVE_VARIANTS[this.variant].label} ready`)
    } catch (err) {
      // Warmup failure is non-fatal — model files may still be loading
      log.warn('Warmup failed:', err)
      this.onProgress?.(`Qwen3-ASR Native ${QWEN_ASR_NATIVE_VARIANTS[this.variant].label} ready (warmup skipped)`)
    } finally {
      try { unlinkSync(warmupPath) } catch { /* ignore */ }
    }
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.binaryPath || !this.modelDir) return null

    const tempPath = join(tmpdir(), `qwen-asr-native-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)

      const text = await this.runTranscribe(tempPath, TRANSCRIBE_TIMEOUT_MS)
      if (!text.trim()) return null

      // qwen_asr CLI does not output structured language info —
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
    this.modelDir = null
    this.initPromise = null
  }

  /**
   * Run `qwen_asr -d <model_dir> -i <wav_file> --silent` and return transcribed text.
   *
   * --silent suppresses progress/debug output, leaving only the transcription.
   */
  private runTranscribe(audioPath: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.binaryPath || !this.modelDir) {
        reject(new Error('Binary or model path not set'))
        return
      }

      const args = [
        '-d', this.modelDir,
        '-i', audioPath,
        '--silent'
      ]

      execFile(this.binaryPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message
          reject(new Error(`qwen_asr error: ${msg}`))
          return
        }

        // Output is the transcribed text on stdout
        resolve(stdout.trim())
      })
    })
  }
}

/** Find the qwen_asr binary in well-known locations */
function findQwenAsrBinary(): string | null {
  for (const p of QWEN_ASR_BINARY_PATHS) {
    if (existsSync(p)) {
      // Verify it's executable
      try {
        execSync(`"${p}" --help`, { stdio: 'ignore', timeout: 5000 })
        return p
      } catch {
        // Binary exists but may not be executable or is broken
        log.warn(`Found binary at ${p} but it's not usable`)
      }
    }
  }

  // Try PATH lookup
  try {
    const which = execSync('which qwen_asr', { encoding: 'utf-8', timeout: 3000 }).trim()
    if (which && existsSync(which)) return which
  } catch { /* not in PATH */ }

  return null
}

/**
 * Find the model directory relative to the binary or in common locations.
 * antirez/qwen-asr expects the model dir to contain safetensors files.
 */
function findModelDir(binaryPath: string, dirName: string): string | null {
  const candidates = [
    // Next to the binary (typical build-from-source layout)
    join(dirname(binaryPath), dirName),
    // Home directory
    join(homedir(), 'qwen-asr', dirName),
    join(homedir(), '.cache', 'qwen-asr', dirName),
    // /opt/homebrew or /usr/local
    join('/opt/homebrew/share/qwen-asr', dirName),
    join('/usr/local/share/qwen-asr', dirName)
  ]

  for (const dir of candidates) {
    if (existsSync(dir)) {
      // Verify it contains model files (safetensors or bin)
      try {
        const files = require('fs').readdirSync(dir) as string[]
        const hasModel = files.some(
          (f: string) => f.endsWith('.safetensors') || f.endsWith('.bin') || f === 'config.json'
        )
        if (hasModel) return dir
      } catch { /* ignore read errors */ }
    }
  }

  return null
}

/** Get directory name from a file path */
function dirname(p: string): string {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

/**
 * Fallback script-based language detection when the CLI does not
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
