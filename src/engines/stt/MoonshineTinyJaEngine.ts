import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult } from '../types'
import { SubprocessBridge, resolveBridgeScript, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import {
  MOONSHINE_TINY_JA_TRANSCRIBE_TIMEOUT_MS,
  MOONSHINE_TINY_JA_INIT_TIMEOUT_MS,
  PYTHON_IMPORT_CHECK_TIMEOUT_MS
} from '../constants'

/**
 * Moonshine Tiny JA — ultra-fast draft STT engine for Japanese.
 *
 * 27M params (~100MB model), achieves 845ms latency (37% faster than baseline).
 * JA CER 10.1% — lower accuracy than primary STT but much faster for interim results.
 *
 * IMPORTANT:
 * - Outputs ONLY Japanese — EN input becomes garbage.
 * - Only useful when source language is JA.
 * - Output has spaces between characters (e.g. "お は よ う") — stripped in processAudio.
 * - Uses Python 3.12 (Python 3.14 has segfault issues with torch).
 * - Apple Silicon preferred (MPS), but also works on CPU.
 */
export class MoonshineTinyJaEngine extends SubprocessBridge implements STTEngine {
  readonly id = 'moonshine-tiny-ja'
  readonly name = 'Moonshine Tiny JA (Ultra-fast draft)'
  readonly isOffline = true

  private model: string
  private onProgress?: (message: string) => void

  constructor(options?: {
    model?: string
    onProgress?: (message: string) => void
  }) {
    super()
    this.model = options?.model ?? 'UsefulSensors/moonshine-tiny-ja'
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[moonshine-tiny-ja]'
  }

  protected getInitTimeout(): number {
    return MOONSHINE_TINY_JA_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return MOONSHINE_TINY_JA_TRANSCRIBE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting Moonshine Tiny JA bridge...')
    const python3 = findPython3WithTransformers()
    this.onProgress?.(`Using Python: ${python3}`)
    return {
      command: python3,
      args: [resolveBridgeScript('moonshine-tiny-ja-bridge.py')],
      initMessage: {
        action: 'init',
        model: this.model
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 with transformers and torch not found. ' +
      'Install: python3.12 -m pip install transformers torch'
    )
  }

  protected onInitComplete(_result: InitResult): void {
    this.onProgress?.('Moonshine Tiny JA ready')
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `moonshine-tiny-ja-${Date.now()}.wav`)
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

      // Strip spaces between Japanese characters — model outputs "お は よ う"
      const rawText = (result.text as string).trim()
      const text = stripJapaneseSpaces(rawText)

      return {
        text,
        language: 'ja',
        isFinal: true,
        timestamp: Date.now()
      }
    } finally {
      try { unlinkSync(tempPath) } catch (e) { this.log.warn('Failed to delete temp file:', e) }
    }
  }
}

/**
 * Strip spaces between Japanese characters.
 * Moonshine Tiny JA outputs text like "お は よ う ご ざ い ま す".
 * Remove spaces that are flanked by CJK/Kana/Katakana characters.
 */
function stripJapaneseSpaces(text: string): string {
  // Match a space preceded and followed by CJK unified ideograph, hiragana, or katakana
  return text.replace(
    /([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g,
    '$1$2'
  )
}

/**
 * Find a python3 binary that has transformers and torch installed.
 * Prefers Python 3.12 (3.14 has segfault issues with torch on Apple Silicon).
 */
function findPython3WithTransformers(): string {
  // Check common venv locations first
  const venvPaths = [
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import transformers; import torch"`, { stdio: 'ignore', timeout: PYTHON_IMPORT_CHECK_TIMEOUT_MS })
      return p
    } catch { /* transformers not installed in this venv */ }
  }

  // Try versioned python binaries (prefer 3.12 over 3.14 due to torch segfault)
  for (const bin of ['python3.12', 'python3.13', 'python3']) {
    try {
      execSync(`${bin} -c "import transformers; import torch"`, { stdio: 'ignore', timeout: PYTHON_IMPORT_CHECK_TIMEOUT_MS })
      return bin
    } catch { /* not available or deps not installed */ }
  }

  throw new Error('Python 3 with transformers and torch not found')
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
