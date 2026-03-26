import { execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import { SENSEVOICE_TRANSCRIBE_TIMEOUT_MS, SENSEVOICE_INIT_TIMEOUT_MS, PYTHON_IMPORT_CHECK_TIMEOUT_MS } from '../constants'

/**
 * SenseVoice STT engine using FunASR Python subprocess bridge.
 * SenseVoice-Small achieves up to 15x faster inference than Whisper
 * with strong accuracy on CJK languages (JA/EN/ZH/KO).
 * Also provides emotion recognition and audio event detection.
 *
 * Requires: python3 with `funasr` package installed.
 */
export class SenseVoiceEngine extends SubprocessBridge implements STTEngine {
  readonly id = 'sensevoice'
  readonly name = 'SenseVoice (CJK-optimized, fast)'
  readonly isOffline = true

  private model: string
  private onProgress?: (message: string) => void

  constructor(options?: {
    model?: string
    onProgress?: (message: string) => void
  }) {
    super()
    this.model = options?.model ?? 'FunAudioLLM/SenseVoiceSmall'
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[sensevoice]'
  }

  protected getInitTimeout(): number {
    return SENSEVOICE_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return SENSEVOICE_TRANSCRIBE_TIMEOUT_MS
  }

  protected override onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting SenseVoice bridge...')
    const python3 = findPython3WithFunASR()
    this.onProgress?.(`Using Python: ${python3}`)
    return {
      command: python3,
      args: [join(__dirname, '../../resources/sensevoice-bridge.py')],
      initMessage: {
        action: 'init',
        model: this.model
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 with funasr not found. Create a venv and install: ' +
      'python3 -m venv ~/sensevoice-env && ~/sensevoice-env/bin/pip install funasr torch torchaudio'
    )
  }

  protected onInitComplete(result: InitResult): void {
    const device = result.device ? ` on ${result.device}` : ''
    this.onProgress?.(`SenseVoice ready${device}`)
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `sensevoice-${Date.now()}.wav`)
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
        console.error('[sensevoice] Bridge error:', err instanceof Error ? err.message : err)
        return null
      }

      if (result.error) {
        console.error('[sensevoice] Transcription error:', result.error)
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
      try { unlinkSync(tempPath) } catch (e) { console.warn('[sensevoice] Failed to delete temp file:', e) }
    }
  }
}

/** Find a python3 binary that has funasr installed */
function findPython3WithFunASR(): string {
  const venvPaths = [
    join(homedir(), 'sensevoice-env', 'bin', 'python3'),
    join(homedir(), 'funasr-env', 'bin', 'python3'),
    join(homedir(), 'mlx-env', 'bin', 'python3'),
    join(homedir(), '.venv', 'bin', 'python3'),
    join(homedir(), 'venv', 'bin', 'python3')
  ]

  for (const p of venvPaths) {
    if (!existsSync(p)) continue
    try {
      execSync(`${p} -c "import funasr"`, { stdio: 'ignore', timeout: PYTHON_IMPORT_CHECK_TIMEOUT_MS })
      return p
    } catch { /* funasr not installed in this venv */ }
  }

  // Fall back to system python3
  try {
    execSync('python3 -c "import funasr"', { stdio: 'ignore', timeout: PYTHON_IMPORT_CHECK_TIMEOUT_MS })
    return 'python3'
  } catch { /* not available */ }

  throw new Error('funasr not found')
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
